//! Tree-walking expression evaluator (plan §5).
//!
//! [`EvalContext`] evaluates one [`Expr`] against a snapshot of cell
//! values. Function calls are dispatched through [`crate::functions`] with
//! *unevaluated* argument expressions, so special forms (`IF`, `IFERROR`)
//! can evaluate arguments on demand.
//!
//! Coercion: direct scalar arguments use [`Value::to_number`] /
//! [`Value::to_boolean`] / [`Value::to_text`]; range-derived values follow
//! each function's own spec (`docs/functions/<NAME>.md`).
//!
//! Safety: [`MAX_EVAL_STEPS`] bounds the total work of one recalculation;
//! expression recursion is bounded by [`MAX_EVAL_DEPTH`]. Exceeding either
//! returns [`EvalError`], never a hang or panic.

use std::collections::HashMap;
use std::fmt;

use crate::array::ArrayValue;
use crate::ast::{BinaryOp, Expr, Literal, UnaryOp};
use crate::cell::{CellId, CellRef, RangeRef};
use crate::error::CalcError;
use crate::value::Value;
use crate::workbook::{DateSystem, Workbook};

/// Evaluation step budget per recalculation (plan §10.4: 評価ステップ100万).
pub const MAX_EVAL_STEPS: usize = 1_000_000;

/// Maximum nested call/unary/binary depth during evaluation. Matches the
/// parser's depth cap so a parsed formula can never exceed it.
pub const MAX_EVAL_DEPTH: usize = crate::parser::MAX_DEPTH;

/// Fatal evaluation conditions that cannot be represented as a cell
/// `#ERR!` value. These abort the whole recalculation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvalError {
    /// The [`MAX_EVAL_STEPS`] budget (or a configured tighter budget) was
    /// exhausted mid-evaluation.
    StepBudgetExceeded,
    /// Expression nesting exceeded [`MAX_EVAL_DEPTH`]. Unreachable for
    /// parser-produced ASTs; kept for manually-constructed ones.
    DepthExceeded,
}

impl fmt::Display for EvalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EvalError::StepBudgetExceeded => write!(f, "evaluation step budget exceeded"),
            EvalError::DepthExceeded => write!(f, "evaluation depth exceeded"),
        }
    }
}

impl std::error::Error for EvalError {}

/// Source of time for volatile functions. Injected so functions like
/// `TODAY`/`NOW` (Phase 5) never read the system clock directly
/// (plan §5: 非決定的関数`TODAY`は注入したClockから値を取得).
pub trait Clock {
    /// Seconds since the Unix epoch (UTC).
    fn unix_seconds(&self) -> i64;
}

/// Clock backed by [`std::time::SystemTime`].
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn unix_seconds(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }
}

/// Deterministic clock for tests and reproducible recalculation.
#[derive(Debug, Clone, Copy)]
pub struct FixedClock(pub i64);

impl Clock for FixedClock {
    fn unix_seconds(&self) -> i64 {
        self.0
    }
}

/// The result of evaluating a single argument expression.
///
/// Whether an argument was written as a scalar or as a range matters for
/// coercion: `SUM("3")` coerces the text but `SUM(A1)` ignores a text
/// cell. [`EvalContext::eval_arg`] preserves that distinction; scalar use
/// of a range collapses to [`Value::Array`].
#[derive(Debug, Clone, PartialEq)]
pub enum ArgValue {
    /// A scalar argument (literal, cell ref, sub-expression result).
    Scalar(Value),
    /// A range argument: row-major matrix of the referenced cells' values.
    Range(ArrayValue),
}

impl ArgValue {
    /// Collapse to a scalar [`Value`] (ranges become `Value::Array`).
    pub fn into_value(self) -> Value {
        match self {
            ArgValue::Scalar(v) => v,
            ArgValue::Range(a) => Value::Array(a),
        }
    }
}

/// Evaluates expression trees against a workbook snapshot.
///
/// `values` must contain the current value of every populated cell
/// (maintained by [`crate::engine::CalcEngine`]); cells absent from the map
/// read as [`Value::Blank`].
pub struct EvalContext<'a> {
    workbook: &'a Workbook,
    values: &'a HashMap<CellId, Value>,
    clock: &'a dyn Clock,
    /// Sheet the evaluated formula lives on (for unqualified references).
    current_sheet: u32,
    max_steps: usize,
    steps: usize,
    depth: usize,
}

impl<'a> EvalContext<'a> {
    pub fn new(
        workbook: &'a Workbook,
        values: &'a HashMap<CellId, Value>,
        clock: &'a dyn Clock,
        current_sheet: u32,
    ) -> EvalContext<'a> {
        EvalContext {
            workbook,
            values,
            clock,
            current_sheet,
            max_steps: MAX_EVAL_STEPS,
            steps: 0,
            depth: 0,
        }
    }

    /// Override the step budget (tests, tighter engine configs).
    pub fn set_max_steps(&mut self, max_steps: usize) {
        self.max_steps = max_steps;
    }

    /// Steps consumed so far.
    pub fn steps(&self) -> usize {
        self.steps
    }

    /// The injected clock (for future volatile functions).
    pub fn clock(&self) -> &dyn Clock {
        self.clock
    }

    /// The workbook's date system (for future date functions).
    pub fn date_system(&self) -> DateSystem {
        self.workbook.date_system()
    }

    /// Evaluate `expr` to a scalar [`Value`]; a range used in scalar
    /// position collapses to [`Value::Array`].
    pub fn eval(&mut self, expr: &Expr) -> Result<Value, EvalError> {
        Ok(self.eval_arg(expr)?.into_value())
    }

    /// Evaluate `expr` preserving the scalar-vs-range distinction.
    pub fn eval_arg(&mut self, expr: &Expr) -> Result<ArgValue, EvalError> {
        self.step()?;
        if self.depth >= MAX_EVAL_DEPTH {
            return Err(EvalError::DepthExceeded);
        }
        self.depth += 1;
        let result = self.eval_node(expr);
        self.depth -= 1;
        result
    }

    fn eval_node(&mut self, expr: &Expr) -> Result<ArgValue, EvalError> {
        match expr {
            Expr::Literal(l) => Ok(ArgValue::Scalar(literal_value(l))),
            Expr::Missing => Ok(ArgValue::Scalar(Value::Blank)),
            Expr::Name(_) => Ok(ArgValue::Scalar(Value::Error(CalcError::Name))),
            Expr::Unary { op, operand } => {
                let v = self.eval(operand)?;
                Ok(ArgValue::Scalar(unary_op(*op, &v)))
            }
            Expr::Percent(operand) => {
                let v = self.eval(operand)?;
                Ok(ArgValue::Scalar(match v.error() {
                    Some(e) => Value::Error(e),
                    None => match v.to_number() {
                        Ok(n) => Value::Number(n / 100.0),
                        Err(e) => Value::Error(e),
                    },
                }))
            }
            Expr::Binary { op, left, right } => {
                let l = self.eval(left)?;
                if let Some(e) = l.error() {
                    return Ok(ArgValue::Scalar(Value::Error(e)));
                }
                let r = self.eval(right)?;
                if let Some(e) = r.error() {
                    return Ok(ArgValue::Scalar(Value::Error(e)));
                }
                Ok(ArgValue::Scalar(binary_op(*op, &l, &r)))
            }
            Expr::Call { name, args } => match crate::functions::dispatch(name, self, args) {
                Some(result) => result.map(ArgValue::Scalar),
                None => Ok(ArgValue::Scalar(Value::Error(CalcError::Name))),
            },
            Expr::CellRef { sheet, cell } => Ok(ArgValue::Scalar(self.cell_value(sheet, cell))),
            Expr::RangeRef { sheet, range } => self.range_values(sheet.as_deref(), range),
        }
    }

    /// Value of a single referenced cell; `#REF!` for unknown sheets.
    fn cell_value(&self, sheet: &Option<String>, cell: &CellRef) -> Value {
        let Some(sheet_id) = self.resolve_sheet(sheet.as_deref()) else {
            return Value::Error(CalcError::Ref);
        };
        self.values
            .get(&CellId {
                sheet_id,
                row: cell.row,
                col: cell.col,
            })
            .cloned()
            .unwrap_or(Value::Blank)
    }

    /// Materialize a range into an [`ArgValue::Range`] of cell values.
    ///
    /// Unknown sheets and over-limit ranges produce scalar error values so
    /// they propagate (rather than being ignored the way in-range error
    /// cells are by some functions).
    fn range_values(
        &mut self,
        sheet: Option<&str>,
        range: &RangeRef,
    ) -> Result<ArgValue, EvalError> {
        let Some(sheet_id) = self.resolve_sheet(sheet) else {
            return Ok(ArgValue::Scalar(Value::Error(CalcError::Ref)));
        };
        if range.cell_count() > crate::array::MAX_ARRAY_CELLS as u64 {
            return Ok(ArgValue::Scalar(Value::Error(CalcError::Value)));
        }
        let n = range.normalized();
        let rows = n.end.row - n.start.row + 1;
        let cols = n.end.col - n.start.col + 1;
        let mut cells = Vec::with_capacity(rows as usize * cols as usize);
        for row in n.start.row..=n.end.row {
            for col in n.start.col..=n.end.col {
                self.step()?;
                cells.push(
                    self.values
                        .get(&CellId { sheet_id, row, col })
                        .cloned()
                        .unwrap_or(Value::Blank),
                );
            }
        }
        match ArrayValue::new(rows, cols, cells) {
            Ok(a) => Ok(ArgValue::Range(a)),
            Err(e) => Ok(ArgValue::Scalar(Value::Error(e))),
        }
    }

    fn resolve_sheet(&self, sheet: Option<&str>) -> Option<u32> {
        match sheet {
            None => Some(self.current_sheet),
            Some(name) => self.workbook.sheet_id(name),
        }
    }

    /// Count one unit of work against the budget.
    pub fn step(&mut self) -> Result<(), EvalError> {
        self.steps += 1;
        if self.steps > self.max_steps {
            return Err(EvalError::StepBudgetExceeded);
        }
        Ok(())
    }
}

fn literal_value(l: &Literal) -> Value {
    match l {
        Literal::Number(n) => Value::Number(*n),
        Literal::Text(s) => Value::Text(s.clone()),
        Literal::Bool(b) => Value::Boolean(*b),
        Literal::Error(e) => Value::Error(*e),
    }
}

fn unary_op(op: UnaryOp, v: &Value) -> Value {
    match v.to_number() {
        Ok(n) => Value::Number(match op {
            UnaryOp::Neg => -n,
            UnaryOp::Pos => n,
        }),
        Err(e) => Value::Error(e),
    }
}

fn binary_op(op: BinaryOp, l: &Value, r: &Value) -> Value {
    match op {
        BinaryOp::Add | BinaryOp::Sub | BinaryOp::Mul | BinaryOp::Div | BinaryOp::Pow => {
            arithmetic(op, l, r)
        }
        BinaryOp::Concat => match (l.to_text(), r.to_text()) {
            (Ok(a), Ok(b)) => Value::Text(a + &b),
            (Err(e), _) | (_, Err(e)) => Value::Error(e),
        },
        BinaryOp::Eq | BinaryOp::Ne | BinaryOp::Lt | BinaryOp::Le | BinaryOp::Gt | BinaryOp::Ge => {
            comparison(op, l, r)
        }
    }
}

fn arithmetic(op: BinaryOp, l: &Value, r: &Value) -> Value {
    let (a, b) = match (l.to_number(), r.to_number()) {
        (Ok(a), Ok(b)) => (a, b),
        (Err(e), _) | (_, Err(e)) => return Value::Error(e),
    };
    match op {
        BinaryOp::Add => Value::Number(a + b),
        BinaryOp::Sub => Value::Number(a - b),
        BinaryOp::Mul => Value::Number(a * b),
        BinaryOp::Div => {
            if b == 0.0 {
                Value::Error(CalcError::DivZero)
            } else {
                Value::Number(a / b)
            }
        }
        BinaryOp::Pow => {
            let n = a.powf(b);
            if n.is_nan() {
                Value::Error(CalcError::Num)
            } else {
                Value::Number(n)
            }
        }
        _ => unreachable!("arithmetic dispatch"),
    }
}

/// Excel comparison type order: numbers < text < booleans.
fn type_rank(v: &Value) -> u8 {
    match v {
        Value::Number(_) | Value::Blank => 0,
        Value::Text(_) => 1,
        Value::Boolean(_) => 2,
        Value::Error(_) | Value::Array(_) => 3,
    }
}

/// Order two non-error values the way Excel comparisons do.
///
/// `Blank` compares as `0` against numbers and `""` against text
/// (Excel treats an empty cell as the zero of the compared type).
fn compare_values(l: &Value, r: &Value) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    match (l, r) {
        (Value::Number(a), Value::Number(b)) => a.partial_cmp(b).unwrap_or(Ordering::Equal),
        (Value::Text(a), Value::Text(b)) => a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()),
        (Value::Boolean(a), Value::Boolean(b)) => a.cmp(b),
        (Value::Blank, Value::Blank) => Ordering::Equal,
        (Value::Blank, Value::Number(b)) => 0.0f64.partial_cmp(b).unwrap_or(Ordering::Equal),
        (Value::Number(a), Value::Blank) => a.partial_cmp(&0.0).unwrap_or(Ordering::Equal),
        (Value::Blank, Value::Text(b)) => "".cmp(b.to_ascii_lowercase().as_str()),
        (Value::Text(a), Value::Blank) => a.to_ascii_lowercase().as_str().cmp(""),
        (Value::Blank, Value::Boolean(_)) | (Value::Boolean(_), Value::Blank) => {
            type_rank(l).cmp(&type_rank(r))
        }
        _ => type_rank(l).cmp(&type_rank(r)),
    }
}

fn comparison(op: BinaryOp, l: &Value, r: &Value) -> Value {
    // `=`/`<>` are equality-only across differing types; ordering
    // operators fall back to the cross-type rank order.
    let eq_types = l.kind() == r.kind() || l.is_blank() || r.is_blank();
    let ord = compare_values(l, r);
    let result = match op {
        BinaryOp::Eq => eq_types && ord == std::cmp::Ordering::Equal,
        BinaryOp::Ne => !(eq_types && ord == std::cmp::Ordering::Equal),
        BinaryOp::Lt => ord == std::cmp::Ordering::Less,
        BinaryOp::Le => ord != std::cmp::Ordering::Greater,
        BinaryOp::Gt => ord == std::cmp::Ordering::Greater,
        BinaryOp::Ge => ord != std::cmp::Ordering::Less,
        _ => unreachable!("comparison dispatch"),
    };
    Value::Boolean(result)
}
