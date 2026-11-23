//! `COLUMNS(array)` — number of columns in a reference or array.
//! Spec: `docs/functions/COLUMNS.md`. Mirror of `ROWS` across the other
//! axis; same scalar-input caveat (SPEC-OPEN).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    Ok(match ctx.eval_arg(&args[0])? {
        ArgValue::Range(a) => Value::Number(a.cols() as f64),
        ArgValue::Scalar(Value::Array(a)) => Value::Number(a.cols() as f64),
        ArgValue::Scalar(Value::Error(e)) => Value::Error(e),
        ArgValue::Ref(v) if v.is_error() => v,
        ArgValue::Ref(_) => Value::Number(1.0),
        ArgValue::Scalar(_) => Value::Error(CalcError::Value),
    })
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn n(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            o => panic!("expected number, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn row_range() {
        assert_eq!(n(&eval("=COLUMNS(A1:E1)")), 5.0);
    }

    #[test]
    fn grid_range() {
        assert_eq!(n(&eval("=COLUMNS(A1:C10)")), 3.0);
    }

    #[test]
    fn single_column_range() {
        assert_eq!(n(&eval("=COLUMNS(A1:A9)")), 1.0);
    }

    #[test]
    fn single_cell() {
        assert_eq!(n(&eval("=COLUMNS(B7)")), 1.0);
    }

    #[test]
    fn errors_inside_do_not_propagate() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero))],
            "=COLUMNS(A1:C1)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn blanks_count() {
        assert_eq!(n(&eval("=COLUMNS(A1:ZZ1)")), 702.0);
    }

    #[test]
    fn scalar_is_value_error() {
        assert_eq!(e(&eval("=COLUMNS(5)")), CalcError::Value);
        assert_eq!(e(&eval(r#"=COLUMNS("x")"#)), CalcError::Value);
    }

    #[test]
    fn error_scalar_propagates() {
        assert_eq!(e(&eval("=COLUMNS(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn nested_range_function_result() {
        // COLUMN(A1:C1) returns a 1x3 array; COLUMNS of it is 3.
        assert_eq!(n(&eval("=COLUMNS(COLUMN(A1:C1))")), 3.0);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=COLUMNS()")), CalcError::Value);
        assert_eq!(e(&eval("=COLUMNS(A1,B1)")), CalcError::Value);
    }
}
