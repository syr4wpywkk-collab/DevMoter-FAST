//! Criteria matching (v2 §3): the single owner of the `[operator] operand`
//! grammar used by `SUMIF`/`SUMIFS`/`COUNTIF`/`COUNTIFS` — comparison
//! prefixes (`=`, `<>`, `>`, `>=`, `<`, `<=`), numeric operand coercion,
//! wildcards (`*`, `?`, `~` escapes), case-insensitive text equality, and
//! blank/non-blank matching.
//!
//! Shared evaluation helpers for the conditional aggregates also live
//! here: materializing an argument as a positional cell matrix and
//! resizing `SUMIF`'s `sum_range` to the criteria range's shape.
//!
//! Deliberate choices where the spec docs mark the question SPEC-OPEN
//! (see `docs/functions/SUMIF.md`, `COUNTIF.md`):
//! - Error cells inside a *criteria range* are skipped (never match);
//!   error values in the *criteria argument itself* propagate.
//! - `"="` / `""` match blank cells and empty strings; `"<>"` matches any
//!   non-blank cell. A `<op>` criterion with an empty operand is treated
//!   as comparing against blank.
//! - `<>` against a real operand never matches blank cells.
//! - A numeric-looking string operand (`"5"`) matches numeric cells per
//!   the operator and, under `=`/`<>`, text cells whose text parses to
//!   the same number. A numeric *argument* (`5`) matches numbers only.
//! - Boolean criteria match boolean cells; `"TRUE"`/`"FALSE"` string
//!   criteria match boolean cells and the same text.

use calc_core::array::ArrayValue;
use calc_core::cell::{CellRef, RangeRef};
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::value::{Value, parse_number_text};
use std::cmp::Ordering;

/// Comparison operator from a criteria prefix; `Eq` is the default when
/// the operand carries no prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CmpOp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

impl CmpOp {
    fn test(self, ord: Ordering) -> bool {
        match self {
            CmpOp::Eq => ord == Ordering::Equal,
            CmpOp::Ne => ord != Ordering::Equal,
            CmpOp::Lt => ord == Ordering::Less,
            CmpOp::Le => ord != Ordering::Greater,
            CmpOp::Gt => ord == Ordering::Greater,
            CmpOp::Ge => ord != Ordering::Less,
        }
    }

    fn test_f64(self, a: f64, b: f64) -> bool {
        match a.partial_cmp(&b) {
            Some(ord) => self.test(ord),
            None => false,
        }
    }

    /// Case-insensitive text ordering (used for ordered comparisons
    /// against text operands).
    fn test_text(self, a: &str, b: &str) -> bool {
        self.test(fold(a).cmp(&fold(b)))
    }
}

fn fold(s: &str) -> String {
    s.chars().flat_map(char::to_lowercase).collect()
}

/// Parsed operand of a criterion.
#[derive(Debug, Clone, PartialEq)]
enum Operand {
    /// Numeric comparison. `via_string` records whether the operand came
    /// from a *string* criterion: only then do `=`/`<>` also match text
    /// cells that parse to the same number.
    Number { n: f64, via_string: bool },
    /// Boolean equality. `via_string` additionally matches the text
    /// spellings `"TRUE"`/`"FALSE"`.
    Bool { b: bool, via_string: bool },
    /// Text pattern (wildcards under `=`/`<>`, ordered compare otherwise).
    Text(String),
    /// Empty operand (`""`, `"="`, `"<>"` alone): blank/empty matching.
    Blank,
}

/// A parsed criterion: operator + operand.
#[derive(Debug, Clone, PartialEq)]
pub struct Criterion {
    op: CmpOp,
    operand: Operand,
}

impl Criterion {
    /// Parse a criteria *value* (already evaluated by the caller):
    /// numbers/booleans mean equality on that value; text is parsed as
    /// `[operator] operand`; blank means equality on 0 (Excel treats a
    /// blank criteria cell as `0`).
    ///
    /// Errors and arrays are rejected by the caller-facing
    /// [`criterion_from_arg`]; this function assumes a scalar.
    pub fn from_value(v: &Value) -> Result<Criterion, CalcError> {
        match v {
            Value::Error(e) => Err(*e),
            Value::Array(_) | Value::Lambda(_) | Value::Reference(_) => Err(CalcError::Value),
            Value::Number(n) => Ok(Criterion {
                op: CmpOp::Eq,
                operand: Operand::Number {
                    n: *n,
                    via_string: false,
                },
            }),
            Value::Boolean(b) => Ok(Criterion {
                op: CmpOp::Eq,
                operand: Operand::Bool {
                    b: *b,
                    via_string: false,
                },
            }),
            Value::Blank => Ok(Criterion {
                op: CmpOp::Eq,
                operand: Operand::Number {
                    n: 0.0,
                    via_string: false,
                },
            }),
            Value::Text(s) => Ok(parse_text_criterion(s)),
        }
    }

    /// Does `cell` satisfy the criterion? Error cells never match (the
    /// caller decides propagation); blanks match only via [`Operand::Blank`]
    /// rules and never via `<>`.
    pub fn matches(&self, cell: &Value) -> bool {
        if cell.is_error() {
            return false;
        }
        match &self.operand {
            Operand::Blank => {
                let blank_like =
                    matches!(cell, Value::Blank) || matches!(cell, Value::Text(s) if s.is_empty());
                match self.op {
                    CmpOp::Eq | CmpOp::Le | CmpOp::Ge => blank_like,
                    CmpOp::Ne => !blank_like,
                    CmpOp::Lt | CmpOp::Gt => false,
                }
            }
            Operand::Number { n, via_string } => match cell {
                Value::Number(m) => self.op.test_f64(*m, *n),
                Value::Text(s) if *via_string => {
                    let hit = parse_number_text(s).is_some_and(|m| m == *n);
                    match self.op {
                        CmpOp::Eq => hit,
                        CmpOp::Ne => !hit,
                        _ => false,
                    }
                }
                Value::Boolean(_)
                | Value::Blank
                | Value::Text(_)
                | Value::Error(_)
                | Value::Array(_)
                | Value::Lambda(_)
                | Value::Reference(_) => self.op == CmpOp::Ne && !cell.is_blank(),
            },
            Operand::Bool { b, via_string } => {
                let hit = match cell {
                    Value::Boolean(c) => c == b,
                    Value::Text(s) if *via_string => {
                        s.trim()
                            .eq_ignore_ascii_case(if *b { "TRUE" } else { "FALSE" })
                    }
                    _ => false,
                };
                match self.op {
                    CmpOp::Eq => hit,
                    CmpOp::Ne => !hit && !cell.is_blank(),
                    _ => false,
                }
            }
            Operand::Text(pat) => match cell {
                Value::Text(s) => match self.op {
                    CmpOp::Eq => wildcard_match(pat, s),
                    CmpOp::Ne => !wildcard_match(pat, s),
                    op => op.test_text(s, pat),
                },
                Value::Number(_) | Value::Boolean(_) => self.op == CmpOp::Ne,
                Value::Blank
                | Value::Error(_)
                | Value::Array(_)
                | Value::Lambda(_)
                | Value::Reference(_) => false,
            },
        }
    }
}

/// Parse a string criterion: leading `<>`, `<=`, `>=`, `=`, `<`, `>`,
/// then coerce the operand (number, `TRUE`/`FALSE`, wildcard text, or
/// empty). When the operand is empty the criterion compares against blank.
fn parse_text_criterion(s: &str) -> Criterion {
    let (op, rest) = if let Some(r) = s.strip_prefix("<>") {
        (CmpOp::Ne, r)
    } else if let Some(r) = s.strip_prefix("<=") {
        (CmpOp::Le, r)
    } else if let Some(r) = s.strip_prefix(">=") {
        (CmpOp::Ge, r)
    } else if let Some(r) = s.strip_prefix('=') {
        (CmpOp::Eq, r)
    } else if let Some(r) = s.strip_prefix('<') {
        (CmpOp::Lt, r)
    } else if let Some(r) = s.strip_prefix('>') {
        (CmpOp::Gt, r)
    } else {
        (CmpOp::Eq, s)
    };

    let operand = if rest.is_empty() {
        Operand::Blank
    } else if let Some(n) = parse_number_text(rest) {
        Operand::Number {
            n,
            via_string: true,
        }
    } else if rest.trim().eq_ignore_ascii_case("TRUE") {
        Operand::Bool {
            b: true,
            via_string: true,
        }
    } else if rest.trim().eq_ignore_ascii_case("FALSE") {
        Operand::Bool {
            b: false,
            via_string: true,
        }
    } else {
        Operand::Text(rest.to_string())
    };
    Criterion { op, operand }
}

/// Wildcard match: `*` any run (incl. empty), `?` exactly one char, `~x`
/// literal `x`. Case-insensitive.
pub fn wildcard_match(pattern: &str, text: &str) -> bool {
    // Compile the pattern into literal/any tokens, lowercasing literals.
    let mut toks: Vec<Option<char>> = Vec::new(); // None = `*`
    let mut escaped = false;
    for c in pattern.chars() {
        if escaped {
            toks.push(Some(c.to_lowercase().next().unwrap_or(c)));
            escaped = false;
        } else {
            match c {
                '~' => escaped = true,
                '*' => toks.push(None),
                '?' => toks.push(Some('\u{1}')), // sentinel: any single char
                _ => toks.push(Some(c.to_lowercase().next().unwrap_or(c))),
            }
        }
    }
    if escaped {
        // Trailing `~` is a literal `~`.
        toks.push(Some('~'));
    }

    let text: Vec<char> = text.chars().flat_map(char::to_lowercase).collect();
    glob(&toks, &text)
}

fn glob(toks: &[Option<char>], text: &[char]) -> bool {
    // Iterative glob match with backtracking on the last `*`.
    let (mut t, mut s) = (0usize, 0usize);
    let (mut star_t, mut star_s) = (usize::MAX, 0usize);
    while s < text.len() {
        let tok = toks.get(t);
        if matches!(tok, Some(Some('\u{1}'))) || matches!(tok, Some(Some(c)) if *c == text[s]) {
            t += 1;
            s += 1;
        } else if matches!(tok, Some(None)) {
            star_t = t;
            star_s = s;
            t += 1;
        } else if star_t != usize::MAX {
            t = star_t + 1;
            star_s += 1;
            s = star_s;
        } else {
            return false;
        }
    }
    while matches!(toks.get(t), Some(None)) {
        t += 1;
    }
    t == toks.len()
}

/// Evaluate an argument expression into a positional value matrix.
/// Scalars/refs become 1x1; `Value::Array` keeps its shape. Errors are
/// surfaced via `Err(CalcError)` so callers map them to `Value::Error`.
pub fn eval_cells(
    ctx: &mut EvalContext<'_>,
    expr: &calc_core::ast::Expr,
) -> Result<Result<ArrayValue, CalcError>, EvalError> {
    match ctx.eval_arg(expr)? {
        ArgValue::Range(a) => Ok(Ok(a)),
        ArgValue::Scalar(Value::Array(a)) | ArgValue::Ref(Value::Array(a)) => Ok(Ok(a)),
        ArgValue::Scalar(v) | ArgValue::Ref(v) => match v.error() {
            Some(e) => Ok(Err(e)),
            None => Ok(Ok(ArrayValue::fill(1, 1, v).expect("1x1 array"))),
        },
    }
}

/// Evaluate a criteria argument to a [`Criterion`].
pub fn eval_criterion(
    ctx: &mut EvalContext<'_>,
    expr: &calc_core::ast::Expr,
) -> Result<Result<Criterion, CalcError>, EvalError> {
    let v = ctx.eval_arg(expr)?.into_value();
    Ok(Criterion::from_value(&v))
}

/// Evaluate `SUMIF`'s `sum_range`: resized to `rows`x`cols` anchored at
/// the expression's own top-left reference (Excel's documented rule).
/// Non-reference expressions evaluate to a 1x1 matrix.
///
/// When the resized range would run past the grid it is clipped to the
/// grid edge (missing positions simply contribute nothing) — Excel's
/// exact `#REF!`-vs-clip rule is SPEC-OPEN in `docs/functions/SUMIF.md`.
pub fn eval_resized_range(
    ctx: &mut EvalContext<'_>,
    expr: &calc_core::ast::Expr,
    rows: u32,
    cols: u32,
) -> Result<Result<ArrayValue, CalcError>, EvalError> {
    use calc_core::ast::Expr;
    let anchored: Option<(Option<String>, CellRef)> = match expr {
        Expr::CellRef { sheet, cell } => Some((sheet.clone(), *cell)),
        Expr::RangeRef { sheet, range } => {
            let n = range.normalized();
            Some((sheet.clone(), n.start))
        }
        _ => None,
    };
    let Some((sheet, start)) = anchored else {
        return eval_cells(ctx, expr);
    };
    let end = CellRef {
        row: (start.row + rows - 1).min(calc_core::cell::MAX_ROWS - 1),
        col: (start.col + cols - 1).min(calc_core::cell::MAX_COLS - 1),
        row_abs: start.row_abs,
        col_abs: start.col_abs,
    };
    let resized = Expr::RangeRef {
        sheet,
        range: RangeRef { start, end },
    };
    eval_cells(ctx, &resized)
}
