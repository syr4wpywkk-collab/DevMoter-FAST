//! `SKEW.P(number1, [number2], ...)` — population (moment) skewness.
//! Spec: `docs/functions/SKEW.P.md`.
//!
//! `γ2 = (1/n) · Σ((x - x̄)/σ)³` with `σ` the *population* sd —
//! computed directly from the moment definition per the spec (not
//! derived from `SKEW`). `n < 3` or `σ = 0` -> `#DIV/0!`.

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
    let n = nums.len();
    if n < 3 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let var = statistics::population_variance(&nums).unwrap_or(0.0);
    if var == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let sigma = var.sqrt();
    let mean = nums.iter().sum::<f64>() / n as f64;
    let m3 = nums
        .iter()
        .map(|x| {
            let z = (x - mean) / sigma;
            z * z * z
        })
        .sum::<f64>();
    Ok(Value::Number(m3 / n as f64))
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
    fn excel_doc_example() {
        // {3;4;5;2;3;4;5;6;4;7} -> 0.303193.
        let v = n(&eval("=SKEW.P(3,4,5,2,3,4,5,6,4,7)"));
        assert!((v - 0.303193).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn symmetric_gives_zero() {
        assert_eq!(n(&eval("=SKEW.P(1,1,2,2,3,3)")), 0.0);
    }

    #[test]
    fn right_skewed_positive() {
        assert!(n(&eval("=SKEW.P(1,1,1,1,1,2,3,10)")) > 0.0);
    }

    #[test]
    fn magnitude_below_sample_skew() {
        // Population skewness is the smaller-magnitude estimate.
        let s = n(&eval("=SKEW(3,4,5,2,3,4,5,6,4,7)"));
        let sp = n(&eval("=SKEW.P(3,4,5,2,3,4,5,6,4,7)"));
        assert!(sp.abs() < s.abs());
    }

    #[test]
    fn two_values_div_zero() {
        assert_eq!(e(&eval("=SKEW.P(1,2)")), CalcError::DivZero);
    }

    #[test]
    fn identical_values_div_zero() {
        assert_eq!(e(&eval("=SKEW.P(5,5,5)")), CalcError::DivZero);
    }

    #[test]
    fn no_numeric_div_zero() {
        let v = eval_with(&[("A1", "x".into())], "=SKEW.P(A1:A4)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn range_ignores_non_numeric() {
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 4.0.into()),
                ("A3", 5.0.into()),
                ("A4", 2.0.into()),
                ("A5", "skip".into()),
                ("A6", Value::Boolean(true)),
                ("B1", 3.0.into()),
                ("B2", 4.0.into()),
                ("B3", 5.0.into()),
                ("B4", 6.0.into()),
                ("B5", 4.0.into()),
                ("B6", 7.0.into()),
            ],
            "=SKEW.P(A1:A6,B1:B6)",
        );
        assert!((n(&v) - 0.303193).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=SKEW.P("abc",1,2,3)"#)), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=SKEW.P(A1:A4)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn direct_boolean_coerces() {
        // {1,2,3,4} (TRUE=1) -> defined, nonzero skew.
        let v = n(&eval("=SKEW.P(TRUE,2,3,4)"));
        assert!(v.is_finite());
    }
}
