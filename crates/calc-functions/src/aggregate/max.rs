//! `MAX(number1, [number2], ...)` — largest numeric value; `0` when
//! there are none. Spec: `docs/functions/MAX.md`.

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
            nums.iter().copied().reduce(f64::max).unwrap_or(0.0),
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
    fn direct_max() {
        assert_eq!(n(&eval("=MAX(3,1,2)")), 3.0);
    }

    #[test]
    fn range_max() {
        let v = eval_with(
            &[("A1", 3.0.into()), ("A2", 1.0.into()), ("A3", 2.0.into())],
            "=MAX(A1:A3)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn no_numerics_zero() {
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=MAX(A1:A3)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn all_negative() {
        let v = eval_with(
            &[("A1", (-5.0).into()), ("A2", (-1.0).into())],
            "=MAX(A1:A2)",
        );
        assert_eq!(n(&v), -1.0);
    }

    #[test]
    fn ignores_text_and_blank() {
        let v = eval_with(
            &[("A1", 5.0.into()), ("A2", "x".into()), ("A3", 10.0.into())],
            "=MAX(A1:A4)",
        );
        assert_eq!(n(&v), 10.0);
    }

    #[test]
    fn direct_text_coerces() {
        assert_eq!(n(&eval(r#"=MAX("9",7)"#)), 9.0);
    }

    #[test]
    fn single_value() {
        assert_eq!(n(&eval("=MAX(0)")), 0.0);
    }

    #[test]
    fn fractional() {
        assert_eq!(n(&eval("=MAX(1.5,1.4)")), 1.5);
    }

    #[test]
    fn direct_false_coerces_to_zero() {
        // MAX(FALSE,-3): FALSE -> 0 wins over -3 (P1-MAX-009).
        assert_eq!(n(&eval("=MAX(FALSE,-3)")), 0.0);
    }

    #[test]
    fn range_ignores_boolean() {
        let v = eval_with(
            &[("A1", Value::Boolean(true)), ("A2", (-9.0).into())],
            "=MAX(A1:A2)",
        );
        assert_eq!(n(&v), -9.0);
    }

    #[test]
    fn mixed_args() {
        let v = eval_with(
            &[("A1", 4.0.into()), ("A2", 8.0.into()), ("B1", 20.0.into())],
            "=MAX(A1:A2,B1)",
        );
        assert_eq!(n(&v), 20.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MAX(1/0)")), CalcError::DivZero);
    }
}
