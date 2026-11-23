//! `MIN(number1, [number2], ...)` — smallest numeric value; `0` when
//! there are none. Spec: `docs/functions/MIN.md`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    match coercion::collect_numbers(ctx, args)? {
        Err(e) => Ok(Value::Error(e)),
        Ok(nums) => Ok(Value::Number(
            nums.iter().copied().reduce(f64::min).unwrap_or(0.0),
        )),
    }
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
    fn direct_min() {
        assert_eq!(n(&eval("=MIN(3,1,2)")), 1.0);
    }

    #[test]
    fn range_min() {
        let v = eval_with(
            &[("A1", 3.0.into()), ("A2", 1.0.into()), ("A3", 2.0.into())],
            "=MIN(A1:A3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn no_numerics_zero() {
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=MIN(A1:A3)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn negative_min() {
        let v = eval_with(&[("A1", (-5.0).into()), ("A2", 1.0.into())], "=MIN(A1:A2)");
        assert_eq!(n(&v), -5.0);
    }

    #[test]
    fn ignores_text_and_blank() {
        let v = eval_with(
            &[("A1", 5.0.into()), ("A2", "x".into()), ("A3", 10.0.into())],
            "=MIN(A1:A4)",
        );
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn direct_text_coerces() {
        assert_eq!(n(&eval(r#"=MIN("2",7)"#)), 2.0);
    }

    #[test]
    fn single_value() {
        assert_eq!(n(&eval("=MIN(0)")), 0.0);
    }

    #[test]
    fn fractional() {
        assert_eq!(n(&eval("=MIN(1.5,1.4)")), 1.4);
    }

    #[test]
    fn direct_boolean_coerces() {
        assert_eq!(n(&eval("=MIN(TRUE,5)")), 1.0);
    }

    #[test]
    fn range_ignores_boolean() {
        let v = eval_with(
            &[("A1", Value::Boolean(true)), ("A2", 9.0.into())],
            "=MIN(A1:A2)",
        );
        assert_eq!(n(&v), 9.0);
    }

    #[test]
    fn mixed_args() {
        let v = eval_with(
            &[("A1", 4.0.into()), ("A2", 8.0.into()), ("B1", 2.0.into())],
            "=MIN(A1:A2,B1)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MIN(1/0)")), CalcError::DivZero);
    }
}
