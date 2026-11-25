//! `HARMEAN(number1, [number2], ...)` — harmonic mean
//! `n / Σ(1/x_i)` of positive numbers. Spec:
//! `docs/functions/HARMEAN.md`.
//!
//! Any included value `<= 0` is `#NUM!`; no numeric values is
//! `#DIV/0!` (matching `AVERAGE`/`GEOMEAN` — the spec's empty-input
//! question).

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
    let denom = nums.iter().map(|x| 1.0 / x).sum::<f64>();
    Ok(Value::Number(nums.len() as f64 / denom))
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
        assert!((n(&eval("=HARMEAN(4,5,8,7,11,4,3)")) - 5.028375962061728).abs() < 1e-14);
    }

    #[test]
    fn thirds() {
        assert!((n(&eval("=HARMEAN(1,2,4)")) - 12.0 / 7.0).abs() < 1e-15);
    }

    #[test]
    fn two_values() {
        assert!((n(&eval("=HARMEAN(10,20)")) - 40.0 / 3.0).abs() < 1e-13);
    }

    #[test]
    fn zero_is_num() {
        assert_eq!(e(&eval("=HARMEAN(5,0)")), CalcError::Num);
    }

    #[test]
    fn negative_is_num() {
        assert_eq!(e(&eval("=HARMEAN(-1,1)")), CalcError::Num);
    }

    #[test]
    fn no_numeric_div_zero() {
        let v = eval_with(&[("A1", "x".into())], "=HARMEAN(A1:A1)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn range_ignores_text() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", "x".into()), ("A3", 3.0.into())],
            "=HARMEAN(A1:A3)",
        );
        // 2 / (1 + 1/3) = 1.5
        assert_eq!(n(&v), 1.5);
    }

    #[test]
    fn scalar_text_coerces() {
        assert_eq!(n(&eval("=HARMEAN(\"4\")")), 4.0);
    }

    #[test]
    fn scalar_text_value() {
        assert_eq!(e(&eval("=HARMEAN(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", Value::Error(CalcError::NA))],
            "=HARMEAN(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn identical_values() {
        assert_eq!(n(&eval("=HARMEAN(9,9,9)")), 9.0);
    }
}
