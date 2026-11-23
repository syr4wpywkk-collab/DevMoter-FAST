//! `TRIMRANGE(range, [trim_rows], [trim_cols])` — drop leading and/or
//! trailing blank rows and columns. Spec: `docs/functions/TRIMRANGE.md`.
//!
//! Given a reference argument the result stays a reference (so
//! `SUM(TRIMRANGE(...))` aggregates the trimmed area); an array
//! argument yields a trimmed array. "Empty" means `Value::Blank`;
//! `""` formula results count as non-empty (TRIMRANGE.md SPEC-OPEN).
//! A fully-empty input trims to a 1x1 blank anchored at the top-left
//! cell rather than `#CALC!` (also SPEC-OPEN there).

use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::cell::RangeRef;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::reference::RefValue;
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 3) {
        return Ok(Value::Error(e));
    }
    let trim_rows = match trim_arg(ctx, args.get(1))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };
    let trim_cols = match trim_arg(ctx, args.get(2))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };

    // Reference argument: preserve reference-ness in the result.
    if let Ok(r) = ctx.eval_ref(&args[0])? {
        let vals = match ctx.deref(&r)? {
            ArgValue::Range(a) => a,
            ArgValue::Ref(v) => ArrayValue::new(1, 1, vec![v]).expect("1x1"),
            ArgValue::Scalar(Value::Error(e)) => return Ok(Value::Error(e)),
            ArgValue::Scalar(v) => ArrayValue::new(1, 1, vec![v]).expect("1x1"),
        };
        let (r0, r1, c0, c1) = bounds(&vals, trim_rows, trim_cols);
        let mk = |row: u32, col: u32| calc_core::cell::CellRef {
            row,
            col,
            row_abs: false,
            col_abs: false,
        };
        let start = r.range.normalized().start;
        return Ok(Value::Reference(RefValue::new(
            r.sheet_id,
            RangeRef {
                start: mk(start.row + r0, start.col + c0),
                end: mk(start.row + r1, start.col + c1),
            },
        )));
    }

    // Non-reference argument: a scalar is a 1x1 array — nothing to
    // trim, so it passes through unchanged rather than becoming an
    // array result.
    let v = ctx.eval(&args[0])?;
    if let Some(e) = v.error() {
        return Ok(Value::Error(e));
    }
    let a = match v {
        Value::Array(a) => a,
        scalar => return Ok(scalar),
    };
    let (r0, r1, c0, c1) = bounds(&a, trim_rows, trim_cols);
    let mut cells = Vec::with_capacity(((r1 - r0 + 1) * (c1 - c0 + 1)) as usize);
    for r in r0..=r1 {
        for c in c0..=c1 {
            cells.push(a.get(r, c).expect("in bounds").clone());
        }
    }
    match ArrayValue::new(r1 - r0 + 1, c1 - c0 + 1, cells) {
        Ok(t) => Ok(Value::Array(t)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Trimmed `[r0, r1] x [c0, c1]` inclusive bounds honoring the
/// leading/trailing flags. A fully-blank array collapses to `(0,0,0,0)`
/// — the anchor cell (SPEC-OPEN per TRIMRANGE.md).
fn bounds(a: &ArrayValue, trim_rows: u8, trim_cols: u8) -> (u32, u32, u32, u32) {
    let blank = |v: &Value| v.is_blank();
    let (mut r0, mut r1, mut c0, mut c1) = (0, a.rows() - 1, 0, a.cols() - 1);
    if trim_rows & 1 != 0 {
        while r0 <= r1 && (c0..=c1).all(|c| blank(a.get(r0, c).unwrap())) {
            r0 += 1;
        }
    }
    if trim_rows & 2 != 0 {
        while r1 > r0 && (0..a.cols()).all(|c| blank(a.get(r1, c).unwrap())) {
            r1 -= 1;
        }
    }
    if r0 > r1 {
        return (0, 0, 0, 0);
    }
    if trim_cols & 1 != 0 {
        while c0 <= c1 && (r0..=r1).all(|r| blank(a.get(r, c0).unwrap())) {
            c0 += 1;
        }
    }
    if trim_cols & 2 != 0 {
        while c1 > c0 && (r0..=r1).all(|r| blank(a.get(r, c1).unwrap())) {
            c1 -= 1;
        }
    }
    if c0 > c1 {
        return (0, 0, 0, 0);
    }
    (r0, r1, c0, c1)
}

/// `trim_rows`/`trim_cols`: `Expr::Missing`/blank -> `3`; 0..=3 else
/// `#VALUE!`.
fn trim_arg(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
) -> Result<Result<u8, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(3)),
        Some(e) => ctx.eval(e)?,
    };
    if v.is_blank() {
        return Ok(Ok(3));
    }
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    Ok(match v.to_number() {
        Ok(n) if (0.0..=3.0).contains(&n.trunc()) => Ok(n.trunc() as u8),
        _ => Err(CalcError::Value),
    })
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn arr(v: &Value) -> (u32, u32, Vec<Value>) {
        match v {
            Value::Array(a) => (a.rows(), a.cols(), a.cells().to_vec()),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    fn set() -> Vec<(&'static str, Value)> {
        vec![
            ("B2", Value::Number(1.0)),
            ("C2", Value::Number(2.0)),
            ("B3", Value::Number(3.0)),
            ("C3", Value::Number(4.0)),
        ]
    }

    #[test]
    fn trims_all_sides() {
        // A1:C5 with data only in B2:C3.
        let v = eval_with(&set(), "=TRIMRANGE(A1:C5)");
        // Result dereferences to the trimmed B2:C3 block.
        let (r, c, cells) = arr(&v);
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[0], Value::Number(1.0));
    }

    #[test]
    fn trims_trailing_rows_only() {
        let v = eval_with(&set(), "=TRIMRANGE(A1:C5,2,0)");
        let (r, c, _) = arr(&v);
        // Leading blank row kept; columns untrimmed.
        assert_eq!((r, c), (3, 3));
    }

    #[test]
    fn trims_leading_rows_only() {
        let v = eval_with(&set(), "=TRIMRANGE(A1:C5,1,0)");
        let (r, c, _) = arr(&v);
        // Leading blank row dropped; trailing blanks kept.
        assert_eq!((r, c), (4, 3));
    }

    #[test]
    fn zeros_are_not_blank() {
        let (r, c, _) = arr(&eval("=TRIMRANGE({0,0;0,5})"));
        assert_eq!((r, c), (2, 2));
    }

    #[test]
    fn aggregates_trimmed_reference() {
        // Reference semantics: feeds SUM like a written range.
        let v = eval_with(&set(), "=SUM(TRIMRANGE(A1:C5))");
        assert_eq!(v, Value::Number(10.0));
    }

    #[test]
    fn fully_empty_trims_to_anchor() {
        let v = eval_with(&[], "=TRIMRANGE(A1:B2)");
        assert!(v.is_blank());
    }

    #[test]
    fn array_argument_returns_array() {
        // `""` cells count as non-empty (SPEC-OPEN): nothing trims.
        let (r, c, cells) = arr(&eval(r#"=TRIMRANGE({"","","x",""})"#));
        assert_eq!((r, c), (1, 4));
        assert_eq!(cells[0], Value::Text("".into()));
    }

    #[test]
    fn out_of_range_mode() {
        assert_eq!(e(&eval("=TRIMRANGE({1},4)")), CalcError::Value);
        assert_eq!(e(&eval("=TRIMRANGE({1},0,4)")), CalcError::Value);
        assert_eq!(e(&eval("=TRIMRANGE({1},-1)")), CalcError::Value);
    }

    #[test]
    fn non_range_non_array_scalar() {
        // A scalar is a 1x1 array; no blank space to trim.
        let v = eval("=TRIMRANGE(5)");
        assert_eq!(v, Value::Number(5.0));
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=TRIMRANGE(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=TRIMRANGE({1},1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=TRIMRANGE()")), CalcError::Value);
        assert_eq!(e(&eval("=TRIMRANGE({1},0,0,0)")), CalcError::Value);
    }
}
