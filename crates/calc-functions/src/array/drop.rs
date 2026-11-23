//! `DROP(array, rows, [columns])` — removes rows/columns from the
//! start or end of an array; complement of TAKE.
//! Spec: `docs/functions/DROP.md`.

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
    // Missing/blank counts drop nothing on that axis.
    let rows = match int_arg(ctx, args.get(1))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(r) => r.unwrap_or(0),
    };
    let cols = match int_arg(ctx, args.get(2))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(c) => c.unwrap_or(0),
    };

    // Remaining span: [r0, r1) x [c0, c1). Empty -> `#CALC!` (empty
    // arrays are not representable; see DROP.md open question).
    let dr = rows.unsigned_abs().min(u64::from(a.rows())) as u32;
    let dc = cols.unsigned_abs().min(u64::from(a.cols())) as u32;
    let (r0, r1) = if rows >= 0 {
        (dr, a.rows())
    } else {
        (0, a.rows() - dr)
    };
    let (c0, c1) = if cols >= 0 {
        (dc, a.cols())
    } else {
        (0, a.cols() - dc)
    };
    if r0 >= r1 || c0 >= c1 {
        return Ok(Value::Error(CalcError::Calc));
    }
    let mut cells = Vec::with_capacity(((r1 - r0) * (c1 - c0)) as usize);
    for r in r0..r1 {
        for c in c0..c1 {
            cells.push(a.get(r, c).expect("in bounds").clone());
        }
    }
    match ArrayValue::new(r1 - r0, c1 - c0, cells) {
        Ok(t) => Ok(Value::Array(t)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Optional integer count (truncated); `Missing`/blank -> `None` (drop
/// nothing on that axis).
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
    fn drop_first_rows() {
        let (r, _, cells) = arr(&eval("=DROP({1,2;3,4;5,6},1)"));
        assert_eq!(r, 2);
        assert_eq!(cells[0], Value::Number(3.0));
    }

    #[test]
    fn drop_last_rows() {
        let (r, _, cells) = arr(&eval("=DROP({1,2;3,4;5,6},-2)"));
        assert_eq!(r, 1);
        assert_eq!(cells, vec![Value::Number(1.0), Value::Number(2.0)]);
    }

    #[test]
    fn drop_columns() {
        let (r, c, cells) = arr(&eval("=DROP({1,2,3;4,5,6},,1)"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[0], Value::Number(2.0));
        assert_eq!(cells[2], Value::Number(5.0));
    }

    #[test]
    fn drop_last_column() {
        let (_, c, cells) = arr(&eval("=DROP({1,2,3;4,5,6},0,-1)"));
        assert_eq!(c, 2);
        assert_eq!(cells[1], Value::Number(2.0));
    }

    #[test]
    fn drop_nothing() {
        let (r, c, _) = arr(&eval("=DROP({1,2;3,4},0,0)"));
        assert_eq!((r, c), (2, 2));
    }

    #[test]
    fn drop_everything() {
        assert_eq!(e(&eval("=DROP({1,2;3,4},2)")), CalcError::Calc);
        assert_eq!(e(&eval("=DROP({1,2;3,4},1,2)")), CalcError::Calc);
        assert_eq!(e(&eval("=DROP({1,2;3,4},-2)")), CalcError::Calc);
    }

    #[test]
    fn drop_more_than_exists() {
        assert_eq!(e(&eval("=DROP({1,2;3,4},99)")), CalcError::Calc);
    }

    #[test]
    fn fractional_count_truncates() {
        let (r, _, _) = arr(&eval("=DROP({1;2;3},1.9)"));
        assert_eq!(r, 2);
    }

    #[test]
    fn non_numeric_count() {
        assert_eq!(e(&eval(r#"=DROP({1,2},"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=DROP(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval("=DROP({1,2},1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=DROP({1,2})")), CalcError::Value);
        assert_eq!(e(&eval("=DROP({1,2},1,1,1)")), CalcError::Value);
    }

    #[test]
    fn drop_is_complement_of_take() {
        let (_, _, dropped) = arr(&eval("=DROP({1,2;3,4;5,6},1)"));
        let (_, _, taken) = arr(&eval("=TAKE({1,2;3,4;5,6},-2)"));
        assert_eq!(dropped, taken);
    }
}
