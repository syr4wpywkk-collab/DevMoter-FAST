//! `TOCOL(array, [ignore], [scan_by_column])` — flattens an array into
//! a single column. Spec: `docs/functions/TOCOL.md`.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 3) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let ignore = match ignore_arg(ctx, args.get(1))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(i) => i,
    };
    let by_col = match bool_arg(ctx, args.get(2))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };

    let mut cells = Vec::with_capacity(a.len());
    for r in 0..a.rows() {
        for c in 0..a.cols() {
            // Row-major scan by default; `by_col` flips the iteration so
            // column-major order results without a second code path.
            let v = if by_col {
                a.get(c, r).expect("in bounds")
            } else {
                a.get(r, c).expect("in bounds")
            };
            if keep(v, ignore) {
                cells.push(v.clone());
            }
        }
    }
    if cells.is_empty() {
        // Empty arrays are not representable (TOCOL.md open question).
        return Ok(Value::Error(CalcError::Calc));
    }
    match ArrayValue::from_column(cells) {
        Ok(t) => Ok(Value::Array(t)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// `keep` under the `ignore` flag: bit 0 drops blanks, bit 1 drops
/// errors. Only `Value::Blank` counts as blank — `Text("")` is a real
/// string (TOCOL.md open question).
fn keep(v: &Value, ignore: u32) -> bool {
    if v.is_blank() && ignore & 1 != 0 {
        return false;
    }
    if v.is_error() && ignore & 2 != 0 {
        return false;
    }
    true
}

/// `ignore` argument: 0..=3, truncated; `Missing`/blank -> 0.
fn ignore_arg(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
) -> Result<Result<u32, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(0)),
        Some(e) => ctx.eval(e)?,
    };
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    if v.is_blank() {
        return Ok(Ok(0));
    }
    Ok(v.to_number().and_then(|n| {
        let i = n.trunc() as i64;
        if (0..=3).contains(&i) {
            Ok(i as u32)
        } else {
            Err(CalcError::Value)
        }
    }))
}

/// `scan_by_column` flag; `Missing`/blank -> FALSE.
fn bool_arg(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
) -> Result<Result<bool, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(false)),
        Some(e) => ctx.eval(e)?,
    };
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    if v.is_blank() {
        return Ok(Ok(false));
    }
    Ok(v.to_boolean())
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
    fn row_major_default() {
        let (r, c, cells) = arr(&eval("=TOCOL({1,2;3,4})"));
        assert_eq!((r, c), (4, 1));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(2.0),
                Value::Number(3.0),
                Value::Number(4.0)
            ]
        );
    }

    #[test]
    fn column_major_scan() {
        let (_, _, cells) = arr(&eval("=TOCOL({1,2;3,4},,TRUE)"));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(3.0),
                Value::Number(2.0),
                Value::Number(4.0)
            ]
        );
    }

    #[test]
    fn ignore_blanks() {
        let v = eval_with(&[("B1", 5.0.into())], "=TOCOL(A1:B2,1)");
        let (_, _, cells) = arr(&v);
        assert_eq!(cells, vec![Value::Number(5.0)]);
    }

    #[test]
    fn ignore_errors() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=TOCOL({1,2;A1,4},2)",
        );
        let (_, _, cells) = arr(&v);
        assert_eq!(cells.len(), 3);
    }

    #[test]
    fn ignore_both() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=TOCOL({1,2;A1,B1},3)",
        );
        let (_, _, cells) = arr(&v);
        assert_eq!(cells, vec![Value::Number(1.0), Value::Number(2.0)]);
    }

    #[test]
    fn errors_kept_by_default() {
        let (_, _, cells) = arr(&eval("=TOCOL({1,#N/A})"));
        assert_eq!(cells[1], Value::Error(CalcError::NA));
    }

    #[test]
    fn empty_result_is_calc_error() {
        let v = eval_with(&[], "=TOCOL(A1:B2,1)");
        assert_eq!(e(&v), CalcError::Calc);
    }

    #[test]
    fn bad_ignore_value() {
        assert_eq!(e(&eval("=TOCOL({1},4)")), CalcError::Value);
        assert_eq!(e(&eval("=TOCOL({1},-1)")), CalcError::Value);
        assert_eq!(e(&eval(r#"=TOCOL({1},"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=TOCOL(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=TOCOL()")), CalcError::Value);
        assert_eq!(e(&eval("=TOCOL({1},0,TRUE,1)")), CalcError::Value);
    }

    #[test]
    fn single_column_input() {
        let (r, c, _) = arr(&eval("=TOCOL({1;2;3})"));
        assert_eq!((r, c), (3, 1));
    }

    #[test]
    fn empty_string_is_not_blank() {
        let v = eval_with(&[("A1", Value::Text(String::new()))], "=TOCOL(A1,1)");
        let (_, _, cells) = arr(&v);
        assert_eq!(cells, vec![Value::Text(String::new())]);
    }
}
