//! `TAKE(array, rows, [columns])` — contiguous slice from the start or
//! end of an array. Spec: `docs/functions/TAKE.md`.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    // Missing/blank `rows` keeps all rows (Excel: `TAKE(A1:C3,,2)`).
    let rows = match int_arg(ctx, args.get(1))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(r) => r.unwrap_or(a.rows() as i64),
    };
    let cols = match int_arg(ctx, args.get(2))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(c) => c.unwrap_or(a.cols() as i64),
    };

    let (Some(rn), Some(cn)) = (keep_count(rows, a.rows()), keep_count(cols, a.cols())) else {
        // `0` or an over-large magnitude yields an empty array, which
        // this engine does not represent (same as TAKE.md's open
        // question): `#CALC!`.
        return Ok(Value::Error(CalcError::Calc));
    };
    let r0 = if rows < 0 { a.rows() - rn } else { 0 };
    let c0 = if cols < 0 { a.cols() - cn } else { 0 };
    let mut cells = Vec::with_capacity((rn * cn) as usize);
    for r in r0..r0 + rn {
        for c in c0..c0 + cn {
            cells.push(a.get(r, c).expect("in bounds").clone());
        }
    }
    match ArrayValue::new(rn, cn, cells) {
        Ok(t) => Ok(Value::Array(t)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Rows/columns to keep for a signed `take` count; `None` when the
/// count is `0` or exceeds `dim` (empty result -> `#CALC!`).
fn keep_count(take: i64, dim: u32) -> Option<u32> {
    let n = take.unsigned_abs();
    if n == 0 || n > u64::from(dim) {
        None
    } else {
        Some(n as u32)
    }
}

/// Optional integer count argument (truncated); `Missing`/blank -> `None`.
fn int_arg(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
) -> Result<Result<Option<i64>, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(None)),
        Some(e) => ctx.eval(e)?,
    };
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    if v.is_blank() {
        return Ok(Ok(None));
    }
    Ok(v.to_number().map(|n| {
        if n.is_finite() {
            Some(n.trunc() as i64)
        } else {
            Some(i64::MAX)
        }
    }))
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

    #[test]
    fn take_first_rows() {
        let (r, c, cells) = arr(&eval("=TAKE({1,2;3,4;5,6},2)"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[0], Value::Number(1.0));
        assert_eq!(cells[3], Value::Number(4.0));
    }

    #[test]
    fn take_last_rows() {
        let (r, _, cells) = arr(&eval("=TAKE({1,2;3,4;5,6},-1)"));
        assert_eq!(r, 1);
        assert_eq!(cells[0], Value::Number(5.0));
    }

    #[test]
    fn take_columns() {
        let (r, c, cells) = arr(&eval("=TAKE({1,2,3;4,5,6},,2)"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[1], Value::Number(2.0));
        assert_eq!(cells[2], Value::Number(4.0));
    }

    #[test]
    fn take_last_columns() {
        let (_, c, cells) = arr(&eval("=TAKE({1,2,3;4,5,6},1,-1)"));
        assert_eq!(c, 1);
        assert_eq!(cells, vec![Value::Number(3.0)]);
    }

    #[test]
    fn take_all() {
        let (r, c, _) = arr(&eval("=TAKE({1,2;3,4},2,2)"));
        assert_eq!((r, c), (2, 2));
    }

    #[test]
    fn take_too_many() {
        assert_eq!(e(&eval("=TAKE({1,2;3,4},3)")), CalcError::Calc);
        assert_eq!(e(&eval("=TAKE({1,2;3,4},1,3)")), CalcError::Calc);
        assert_eq!(e(&eval("=TAKE({1,2;3,4},-3)")), CalcError::Calc);
    }

    #[test]
    fn take_zero() {
        assert_eq!(e(&eval("=TAKE({1,2;3,4},0)")), CalcError::Calc);
        assert_eq!(e(&eval("=TAKE({1,2;3,4},1,0)")), CalcError::Calc);
    }

    #[test]
    fn fractional_count_truncates() {
        let (r, _, _) = arr(&eval("=TAKE({1;2;3},1.9)"));
        assert_eq!(r, 1);
    }

    #[test]
    fn non_numeric_count() {
        assert_eq!(e(&eval(r#"=TAKE({1,2},"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=TAKE(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval("=TAKE({1,2},1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=TAKE({1,2})")), CalcError::Value);
        assert_eq!(e(&eval("=TAKE({1,2},1,1,1)")), CalcError::Value);
    }

    #[test]
    fn range_input() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=TAKE(A1:A3,-2)",
        );
        let (r, _, cells) = arr(&v);
        assert_eq!(r, 2);
        assert_eq!(cells, vec![Value::Number(2.0), Value::Number(3.0)]);
    }
}
