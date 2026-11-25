//! Tree-walking expression evaluator (plan §5).
//!
//! [`EvalContext`] evaluates one [`Expr`] against a snapshot of cell
//! values. Function calls are dispatched through a caller-supplied
//! [`FunctionRegistry`](crate::registry::FunctionRegistry) with
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
use crate::cell::{CellId, CellRef, RangeRef, RefTarget, parse_sheet_qualified_ref};
use crate::error::CalcError;
use crate::lambda::LambdaValue;
use crate::reference::{MAX_REF_TEXT_LEN, RefValue};
use crate::value::{Value, round_15};
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

/// Source of randomness for volatile functions (`RAND`, `RANDBETWEEN`).
/// Injected like [`Clock`] so tests are deterministic and `calc-core`
/// stays std-only. Interior mutability (`Cell`) lets the shared
/// `&dyn RngSource` advance the stream during evaluation.
pub trait RngSource {
    /// Next 64 bits of the stream.
    fn next_u64(&self) -> u64;
}

/// Deterministic SplitMix64 PRNG (seeded per workbook by
/// [`crate::CalcEngine`]). Well-distributed, stateless-friendly, and
/// dependency-free.
#[derive(Debug)]
pub struct SplitMix64 {
    state: std::cell::Cell<u64>,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> SplitMix64 {
        SplitMix64 {
            state: std::cell::Cell::new(seed),
        }
    }
}

impl RngSource for SplitMix64 {
    fn next_u64(&self) -> u64 {
        let mut z = self.state.get().wrapping_add(0x9E37_79B9_7F4A_7C15);
        self.state.set(z);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
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
    /// A scalar argument (literal or sub-expression result); direct
    /// argument coercion rules apply.
    Scalar(Value),
    /// A value coming through a single cell reference. Excel applies
    /// range-side rules to references: aggregations ignore text, boolean
    /// and blank cells even when reached via `A1` rather than `A1:A3`.
    Ref(Value),
    /// A range argument: row-major matrix of the referenced cells' values.
    Range(ArrayValue),
}

impl ArgValue {
    /// Collapse to a scalar [`Value`] (ranges become `Value::Array`).
    pub fn into_value(self) -> Value {
        match self {
            ArgValue::Scalar(v) | ArgValue::Ref(v) => v,
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
    rng: &'a dyn RngSource,
    registry: &'a dyn crate::registry::FunctionRegistry,
    /// Cell the evaluated formula lives on. The sheet part resolves
    /// unqualified references; the full position anchors R1C1-relative
    /// and "current cell" semantics (v3 reference functions).
    caller: CellId,
    max_steps: usize,
    steps: usize,
    depth: usize,
    /// Lexical scope chain for `LET` bindings and `LAMBDA` invocation.
    /// Frames are ordered outermost-first; lookup scans innermost-first.
    /// Names are stored lower-cased (Excel names are case-insensitive).
    scopes: Vec<Vec<(String, Value)>>,
}

impl<'a> EvalContext<'a> {
    pub fn new(
        workbook: &'a Workbook,
        values: &'a HashMap<CellId, Value>,
        clock: &'a dyn Clock,
        rng: &'a dyn RngSource,
        registry: &'a dyn crate::registry::FunctionRegistry,
        caller: CellId,
    ) -> EvalContext<'a> {
        EvalContext {
            workbook,
            values,
            clock,
            rng,
            registry,
            caller,
            max_steps: MAX_EVAL_STEPS,
            steps: 0,
            depth: 0,
            scopes: Vec::new(),
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

    /// The injected clock (for volatile date functions).
    pub fn clock(&self) -> &dyn Clock {
        self.clock
    }

    /// The injected random source (for volatile `RAND`/`RANDBETWEEN`).
    pub fn rng(&self) -> &dyn RngSource {
        self.rng
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
    ///
    /// A `Value::Reference` produced by the expression (e.g. an
    /// `OFFSET`-style call) is dereferenced here: 1x1 references become
    /// [`ArgValue::Ref`], larger ones [`ArgValue::Range`], so existing
    /// functions see the same range-side coercion semantics as for a
    /// written `A1`/`A1:B2` argument. Use [`Self::eval_ref`] when the
    /// reference itself — not its values — is the argument.
    pub fn eval_arg(&mut self, expr: &Expr) -> Result<ArgValue, EvalError> {
        let arg = self.eval_arg_keep_refs(expr)?;
        match arg {
            ArgValue::Scalar(Value::Reference(r)) => self.deref(&r),
            other => Ok(other),
        }
    }

    /// Raw argument evaluation: a reference-valued result is kept as
    /// `ArgValue::Scalar(Value::Reference)` for callers that need the
    /// reference object ([`Self::eval_ref`]). Everything else is
    /// identical to [`Self::eval_arg`].
    fn eval_arg_keep_refs(&mut self, expr: &Expr) -> Result<ArgValue, EvalError> {
        self.step()?;
        if self.depth >= MAX_EVAL_DEPTH {
            return Err(EvalError::DepthExceeded);
        }
        self.depth += 1;
        let result = self.eval_node(expr);
        self.depth -= 1;
        result
    }

    /// Dereference `reference` to the values currently stored under it:
    /// [`ArgValue::Ref`] for a single cell, [`ArgValue::Range`] for a
    /// multi-cell range. This is the single point where a
    /// `Value::Reference` turns back into cell data; unknown/deleted
    /// sheets resolve to `#REF!`.
    pub fn deref(&mut self, reference: &RefValue) -> Result<ArgValue, EvalError> {
        if self.workbook.sheet(reference.sheet_id).is_none() {
            return Ok(ArgValue::Scalar(Value::Error(CalcError::Ref)));
        }
        let r = &reference.range;
        if reference.is_single() {
            let v = self
                .values
                .get(&CellId {
                    sheet_id: reference.sheet_id,
                    row: r.start.row,
                    col: r.start.col,
                })
                .cloned()
                .unwrap_or(Value::Blank);
            return Ok(ArgValue::Ref(v));
        }
        if reference.cell_count() > crate::array::MAX_ARRAY_CELLS as u64 {
            return Ok(ArgValue::Scalar(Value::Error(CalcError::Value)));
        }
        let rows = r.end.row - r.start.row + 1;
        let cols = r.end.col - r.start.col + 1;
        let mut cells = Vec::with_capacity(rows as usize * cols as usize);
        for row in r.start.row..=r.end.row {
            for col in r.start.col..=r.end.col {
                self.step()?;
                cells.push(
                    self.values
                        .get(&CellId {
                            sheet_id: reference.sheet_id,
                            row,
                            col,
                        })
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

    /// Evaluate `expr` *as a reference*, the way `OFFSET`'s anchor,
    /// `ISFORMULA`, `AREAS` and friends consume their argument:
    ///
    /// - `Expr::CellRef`/`Expr::RangeRef` resolve to their geometry
    ///   (`#REF!` for a sheet that does not exist).
    /// - Any other expression is evaluated; a `Value::Reference`
    ///   result is returned as-is, an error propagates, and any other
    ///   value is `#VALUE!` (Excel's "argument must be a reference").
    ///
    /// SPEC-OPEN: reference *propagation* through `IF`/`CHOOSE`/`INDEX`
    /// (Excel treats a branch that is a reference as a reference
    /// result) requires the lazy special forms to opt into
    /// [`Self::eval_ref`]/`eval_arg_keep_refs`; only functions
    /// returning `Value::Reference` propagate today.
    pub fn eval_ref(&mut self, expr: &Expr) -> Result<Result<RefValue, CalcError>, EvalError> {
        match expr {
            Expr::CellRef { sheet, cell } => Ok(match self.resolve_sheet(sheet.as_deref()) {
                Some(sheet_id) => Ok(RefValue::single(sheet_id, *cell)),
                None => Err(CalcError::Ref),
            }),
            Expr::RangeRef { sheet, range } => Ok(match self.resolve_sheet(sheet.as_deref()) {
                Some(sheet_id) => Ok(RefValue::new(sheet_id, *range)),
                None => Err(CalcError::Ref),
            }),
            _ => match self.eval_arg_keep_refs(expr)?.into_value() {
                Value::Reference(r) => Ok(Ok(r)),
                Value::Error(e) => Ok(Err(e)),
                _ => Ok(Err(CalcError::Value)),
            },
        }
    }

    /// Parse `text` as an A1-style reference and resolve it against the
    /// workbook — the `ref_text` interpretation `INDIRECT` needs.
    ///
    /// Sheet-qualified forms (`Sheet2!A1`, `'My Sheet'!$A$1`) resolve
    /// against [`Workbook::sheet_id`]; unqualified text binds to the
    /// caller's sheet. Every failure — unparseable text, text beyond
    /// [`MAX_REF_TEXT_LEN`], a sheet that does not exist, coordinates
    /// outside the grid — is `#REF!` (INDIRECT spec).
    ///
    /// Defined names and R1C1 text (`a1=FALSE`) are not parsed here;
    /// they are tracked in `docs/SPEC-OPEN.md`.
    pub fn ref_from_a1_text(&self, text: &str) -> Result<RefValue, CalcError> {
        if text.len() > MAX_REF_TEXT_LEN {
            return Err(CalcError::Ref);
        }
        let parsed = parse_sheet_qualified_ref(text).map_err(|_| CalcError::Ref)?;
        let sheet_id = match &parsed.sheet {
            None => self.caller.sheet_id,
            Some(name) => self.workbook.sheet_id(name).ok_or(CalcError::Ref)?,
        };
        Ok(match parsed.target {
            RefTarget::Cell(cell) => RefValue::single(sheet_id, cell),
            RefTarget::Range(range) => RefValue::new(sheet_id, range),
        })
    }

    /// The cell containing the formula being evaluated (caller
    /// position for R1C1-relative forms and `SHEET()`'s default).
    pub fn caller(&self) -> CellId {
        self.caller
    }

    /// Number of worksheets in the workbook (`SHEETS()`).
    pub fn sheet_count(&self) -> usize {
        self.workbook.sheets().len()
    }

    /// Name of sheet `sheet_id`, or `None` when out of range.
    pub fn sheet_name(&self, sheet_id: u32) -> Option<&str> {
        self.workbook.sheet(sheet_id).map(|s| s.name())
    }

    /// 0-based ordinal of the sheet named `name` (case-insensitive),
    /// which is the `SHEET()` position minus one.
    pub fn sheet_index(&self, name: &str) -> Option<u32> {
        self.workbook.sheet_id(name)
    }

    /// Whether `cell` contains a formula (stored input, regardless of
    /// its evaluated value — `ISFORMULA` semantics).
    pub fn cell_is_formula(&self, cell: CellId) -> bool {
        self.workbook
            .cell(cell.sheet_id, cell.row, cell.col)
            .is_some_and(|c| c.input.is_formula())
    }

    /// The stored formula text of `cell` *without* the leading `=`
    /// (workbook storage form; `FORMULATEXT` prepends `=`). `None`
    /// for blank and literal cells.
    pub fn cell_formula_text(&self, cell: CellId) -> Option<&str> {
        self.workbook
            .cell(cell.sheet_id, cell.row, cell.col)
            .and_then(|c| c.input.formula())
    }

    fn eval_node(&mut self, expr: &Expr) -> Result<ArgValue, EvalError> {
        match expr {
            Expr::Literal(l) => Ok(ArgValue::Scalar(literal_value(l))),
            Expr::Missing => Ok(ArgValue::Scalar(Value::Blank)),
            Expr::Name(n) => Ok(ArgValue::Scalar(
                self.lookup_local(n)
                    .cloned()
                    .unwrap_or(Value::Error(CalcError::Name)),
            )),
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
            Expr::Call { name, args } => match self.registry.dispatch(name, self, args) {
                Some(result) => result.map(ArgValue::Scalar),
                // Not a registered function: a bound name holding a lambda
                // is invoked (`LET(f,LAMBDA(x,x+1),f(5))`), else `#NAME?`.
                None => match self.lookup_local(name).cloned() {
                    Some(Value::Lambda(l)) => {
                        let argv = self.eval_call_args(args)?;
                        self.call_lambda(&l, argv).map(ArgValue::Scalar)
                    }
                    _ => Ok(ArgValue::Scalar(Value::Error(CalcError::Name))),
                },
            },
            Expr::Invoke { callee, args } => {
                let f = self.eval(callee)?;
                match f {
                    Value::Lambda(l) => {
                        let argv = self.eval_call_args(args)?;
                        self.call_lambda(&l, argv).map(ArgValue::Scalar)
                    }
                    Value::Error(e) => Ok(ArgValue::Scalar(Value::Error(e))),
                    _ => Ok(ArgValue::Scalar(Value::Error(CalcError::Value))),
                }
            }
            Expr::CellRef { sheet, cell } => Ok(ArgValue::Ref(self.cell_value(sheet, cell))),
            Expr::RangeRef { sheet, range } => self.range_values(sheet.as_deref(), range),
            Expr::ArrayLiteral(rows) => self.array_literal(rows),
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

    /// Evaluate `{expr,expr;expr,expr}` into a `Value::Array`.
    ///
    /// Each element is evaluated in scalar position and stored verbatim —
    /// errors become array *elements* (Excel does not collapse the whole
    /// literal when one element fails). An element that itself evaluates
    /// to an array (e.g. `{A1:B2}`) is stored as a `#VALUE!` element —
    /// Excel rejects nested arrays at entry; parse-time nesting is not
    /// reachable but range elements can still produce one (SPEC-OPEN:
    /// nested-array element semantics).
    fn array_literal(&mut self, rows: &[Vec<Expr>]) -> Result<ArgValue, EvalError> {
        let nrows = rows.len() as u32;
        let ncols = rows.first().map_or(0, Vec::len) as u32;
        let mut cells = Vec::with_capacity(rows.len() * ncols as usize);
        for row in rows {
            for expr in row {
                let v = self.eval(expr)?;
                cells.push(match v {
                    Value::Array(_) => Value::Error(CalcError::Value),
                    other => other,
                });
            }
        }
        match ArrayValue::new(nrows, ncols, cells) {
            Ok(a) => Ok(ArgValue::Scalar(Value::Array(a))),
            Err(e) => Ok(ArgValue::Scalar(Value::Error(e))),
        }
    }

    fn resolve_sheet(&self, sheet: Option<&str>) -> Option<u32> {
        match sheet {
            None => Some(self.caller.sheet_id),
            Some(name) => self.workbook.sheet_id(name),
        }
    }

    /// Push a lexical scope frame (used by `LET` and lambda invocation).
    pub fn push_scope(&mut self) {
        self.scopes.push(Vec::new());
    }

    /// Pop the innermost lexical scope frame.
    pub fn pop_scope(&mut self) {
        self.scopes.pop();
    }

    /// Bind `name` to `value` in the innermost scope frame (pushing one if
    /// none exists). The name is stored lower-cased.
    pub fn bind_local(&mut self, name: &str, value: Value) {
        if self.scopes.is_empty() {
            self.push_scope();
        }
        let name = name.to_ascii_lowercase();
        let frame = self.scopes.last_mut().unwrap();
        if let Some(slot) = frame.iter_mut().find(|(n, _)| *n == name) {
            slot.1 = value;
        } else {
            frame.push((name, value));
        }
    }

    /// Resolve `name` against the scope chain, innermost frame first.
    /// Case-insensitive.
    pub fn lookup_local(&self, name: &str) -> Option<&Value> {
        let name = name.to_ascii_lowercase();
        self.scopes
            .iter()
            .rev()
            .flat_map(|frame| frame.iter().rev())
            .find(|(n, _)| *n == name)
            .map(|(_, v)| v)
    }

    /// Snapshot the current scope chain as a flat `(name, value)` list
    /// (outermost-first) for [`LambdaValue`] capture.
    pub fn capture_env(&self) -> Vec<(String, Value)> {
        self.scopes.iter().flatten().cloned().collect()
    }

    /// Invoke a [`LambdaValue`] with already-evaluated argument values.
    ///
    /// The captured environment is pushed below the parameter frame, then
    /// the body is evaluated. Arity mismatch yields `#VALUE!`; exceeding
    /// [`MAX_EVAL_DEPTH`] yields `#NUM!` (a defined cell error, never a
    /// Rust stack overflow — body evaluation recurses through
    /// [`EvalContext::eval_arg`], which enforces the depth cap).
    /// Invocations count against the step budget via [`Self::step`].
    ///
    /// SPEC-OPEN: the spec docs suggest `#N/A` may be appropriate for
    /// missing arguments; `#VALUE!` covers all arity mismatches per
    /// `docs/functions/LAMBDA.md`.
    pub fn call_lambda(&mut self, lam: &LambdaValue, args: Vec<Value>) -> Result<Value, EvalError> {
        self.step()?;
        if args.len() != lam.params.len() {
            return Ok(Value::Error(CalcError::Value));
        }
        // One body evaluation costs at least one depth level; fail as a
        // cell error before the hard EvalError::DepthExceeded aborts the
        // whole recalculation.
        if self.depth >= MAX_EVAL_DEPTH {
            return Ok(Value::Error(CalcError::Num));
        }
        self.scopes.push(lam.env.clone());
        let frame = lam
            .params
            .iter()
            .cloned()
            .zip(args)
            .collect::<Vec<(String, Value)>>();
        self.scopes.push(frame);
        let result = self.eval(&lam.body);
        self.scopes.pop();
        self.scopes.pop();
        // Depth cap reached inside the call: surface as `#NUM!` (a cell
        // error) rather than aborting the whole recalculation.
        match result {
            Err(EvalError::DepthExceeded) => Ok(Value::Error(CalcError::Num)),
            r => r,
        }
    }

    /// Evaluate `(` arg `,` ... `)` argument expressions to scalar values.
    /// Missing slots are `#VALUE!` at call time (lambda params have no
    /// defaults) — they evaluate to `Blank` here and arity still matches,
    /// so the lambda sees `Blank`.
    fn eval_call_args(&mut self, args: &[Expr]) -> Result<Vec<Value>, EvalError> {
        args.iter().map(|a| self.eval(a)).collect()
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
        Value::Error(_) | Value::Array(_) | Value::Lambda(_) | Value::Reference(_) => 3,
    }
}

/// Order two non-error values the way Excel comparisons do.
///
/// `Blank` compares as `0` against numbers and `""` against text
/// (Excel treats an empty cell as the zero of the compared type).
fn compare_values(l: &Value, r: &Value) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    match (l, r) {
        // Excel compares numbers at the 15 digits it keeps: `0.1+0.2=0.3` is TRUE.
        (Value::Number(a), Value::Number(b)) => round_15(*a)
            .partial_cmp(&round_15(*b))
            .unwrap_or(Ordering::Equal),
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
