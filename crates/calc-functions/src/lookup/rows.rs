//! `ROWS(array)` — number of rows in a reference or array.
//! Spec: `docs/functions/ROWS.md`.
//!
//! Pure shape query: contents are irrelevant and error cells do not
//! propagate. A single cell reference counts as 1 row. Scalar
//! arguments are `#VALUE!` (SPEC-OPEN: Excel's scalar-input behavior is
//! unconfirmed).

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
        ArgValue::Range(a) => Value::Number(a.rows() as f64),
        ArgValue::Scalar(Value::Array(a)) => Value::Number(a.rows() as f64),
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
    fn column_range() {
        assert_eq!(n(&eval("=ROWS(A1:A10)")), 10.0);
    }

    #[test]
    fn grid_range() {
        assert_eq!(n(&eval("=ROWS(A1:C10)")), 10.0);
    }

    #[test]
    fn single_row_range() {
        assert_eq!(n(&eval("=ROWS(A1:E1)")), 1.0);
    }

    #[test]
    fn single_cell() {
        assert_eq!(n(&eval("=ROWS(B7)")), 1.0);
    }

    #[test]
    fn errors_inside_do_not_propagate() {
        let v = eval_with(&[("A1", Value::Error(CalcError::DivZero))], "=ROWS(A1:A3)");
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn blanks_count() {
        assert_eq!(n(&eval("=ROWS(A1:A100)")), 100.0);
    }

    #[test]
    fn scalar_is_value_error() {
        assert_eq!(e(&eval("=ROWS(5)")), CalcError::Value);
        assert_eq!(e(&eval(r#"=ROWS("x")"#)), CalcError::Value);
    }

    #[test]
    fn error_scalar_propagates() {
        assert_eq!(e(&eval("=ROWS(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn nested_range_function_result() {
        // ROW(A2:A5) returns a 4x1 array; ROWS of it is 4.
        assert_eq!(n(&eval("=ROWS(ROW(A2:A5))")), 4.0);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=ROWS()")), CalcError::Value);
        assert_eq!(e(&eval("=ROWS(A1,B1)")), CalcError::Value);
    }
}
