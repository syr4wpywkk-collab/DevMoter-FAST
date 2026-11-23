//! `GEOMEAN(number1, [number2], ...)` — geometric mean
//! `EXP(AVERAGE(LN(x_i)))` of positive numbers. Spec:
//! `docs/functions/GEOMEAN.md`.
//!
//! Any included value `<= 0` is `#NUM!`; no numeric values is
//! `#DIV/0!` (matching `AVERAGE` — the spec's empty-input question).

use crate::common::coercion;
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
    if nums.is_empty() {
        return Ok(Value::Error(CalcError::DivZero));
    }
    if nums.iter().any(|&x| x <= 0.0) {
        return Ok(Value::Error(CalcError::Num));
    }
    let mean_ln = nums.iter().map(|x| x.ln()).sum::<f64>() / nums.len() as f64;
    Ok(Value::Number(mean_ln.exp()))
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
    fn spec_example() {
        assert!((n(&eval("=GEOMEAN(4,5,8,7,11,4,3)")) - 5.476986969656962).abs() < 1e-14);
    }

    #[test]
    fn spec_example_small() {
        // (1.2·1.5·1.8)^(1/3) — the spec doc's constant is a misprint.
        assert!((n(&eval("=GEOMEAN(1.2,1.5,1.8)")) - 1.479727244598282).abs() < 1e-14);
    }

    #[test]
    fn two_values() {
        assert_eq!(n(&eval("=GEOMEAN(2,8)")), 4.0);
    }

    #[test]
    fn negative_is_num() {
        assert_eq!(e(&eval("=GEOMEAN(1,-1,1)")), CalcError::Num);
    }

    #[test]
    fn zero_is_num() {
        assert_eq!(e(&eval("=GEOMEAN(0,5)")), CalcError::Num);
    }

    #[test]
    fn no_numeric_div_zero() {
        let v = eval_with(&[("A1", "x".into())], "=GEOMEAN(A1:A1)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn range_ignores_text() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", "x".into()), ("A3", 8.0.into())],
            "=GEOMEAN(A1:A3)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn zero_in_range_is_num() {
        let v = eval_with(&[("A1", 0.0.into()), ("A2", 5.0.into())], "=GEOMEAN(A1:A2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn scalar_text_coerces() {
        // Direct scalar text-that-is-number coerces like AVERAGE.
        assert_eq!(n(&eval("=GEOMEAN(\"4\")")), 4.0);
    }

    #[test]
    fn scalar_text_value() {
        assert_eq!(e(&eval("=GEOMEAN(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", Value::Error(CalcError::NA))],
            "=GEOMEAN(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn identical_values() {
        assert!((n(&eval("=GEOMEAN(7,7,7)")) - 7.0).abs() < 1e-14);
    }
}
