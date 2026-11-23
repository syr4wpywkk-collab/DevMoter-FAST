//! `VAR.S(number1, [number2], ...)` — sample variance (denominator
//! n-1). Spec: `docs/functions/VAR_S.md`.
//!
//! Shares the [`statistics::sample_variance`] accumulator with
//! `STDEV.S` — not computed via `sqrt`/`pow` round-trip.

use crate::common::coercion;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let nums = match coercion::collect_numbers(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    match statistics::sample_variance(&nums) {
        Some(v) => Ok(Value::Number(v)),
        None => Ok(Value::Error(CalcError::DivZero)),
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
    fn basic_sample_variance() {
        // VAR.S(1,2,3) = 1
        assert_eq!(n(&eval("=VAR.S(1,2,3)")), 1.0);
    }

    #[test]
    fn two_values() {
        assert_eq!(n(&eval("=VAR.S(1,3)")), 2.0);
    }

    #[test]
    fn single_value_div_zero() {
        assert_eq!(e(&eval("=VAR.S(5)")), CalcError::DivZero);
    }

    #[test]
    fn no_numeric_values_div_zero() {
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=VAR.S(A1:A3)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn all_equal_gives_zero() {
        assert_eq!(n(&eval("=VAR.S(4,4,4)")), 0.0);
    }

    #[test]
    fn fractional_variance() {
        // {1,2,3,4,5}: sample variance = 2.5
        assert_eq!(n(&eval("=VAR.S(1,2,3,4,5)")), 2.5);
    }

    #[test]
    fn range_ignores_text_bool_blank() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "x".into()),
                ("A3", Value::Boolean(true)),
                ("A4", 3.0.into()),
            ],
            "=VAR.S(A1:A5)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=VAR.S("1",3)"#)), 2.0);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=VAR.S("abc",3)"#)), CalcError::Value);
    }

    #[test]
    fn direct_boolean_coerces() {
        assert_eq!(n(&eval("=VAR.S(FALSE,4)")), 8.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::Ref)), ("A2", 1.0.into())],
            "=VAR.S(A1:A3)",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }

    #[test]
    fn large_magnitude_stable() {
        // {1e9, 1e9+1, 1e9+2}: variance = 1 — two-pass avoids cancellation.
        let v = n(&eval("=VAR.S(1000000000,1000000001,1000000002)"));
        assert!((v - 1.0).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn equals_stdev_squared() {
        // Shared accumulator: VAR.S(x)^0.5 consistency, spec doc relation.
        let v = n(&eval("=VAR.S(2,4,4,4,5,5,7,9)"));
        assert_eq!(v, 32.0 / 7.0);
    }
}
