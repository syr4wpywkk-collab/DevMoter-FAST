//! `KURT(number1, [number2], ...)` — excess kurtosis (Fisher's `g2`)
//! with Excel's sample bias correction:
//! `n(n+1)/((n-1)(n-2)(n-3)) · Σ((x-x̄)/s)⁴ - 3(n-1)²/((n-2)(n-3))`
//! where `s` is the sample standard deviation. Spec:
//! `docs/functions/KURT.md`.
//!
//! Fewer than four numeric values or zero variance is `#DIV/0!`.

use crate::common::{coercion, statistics};
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
    if n < 4 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    // Zero variance is reported through the same divisor check:
    // sample_variance returns the divisor-normalized value; a zero
    // result means all values equal.
    let s = match statistics::sample_variance(&nums) {
        Some(v) if v > 0.0 => v.sqrt(),
        _ => return Ok(Value::Error(CalcError::DivZero)),
    };
    let mean = nums.iter().sum::<f64>() / n as f64;
    let z4: f64 = nums.iter().map(|x| ((x - mean) / s).powi(4)).sum();
    let nf = n as f64;
    let k = nf * (nf + 1.0) / ((nf - 1.0) * (nf - 2.0) * (nf - 3.0)) * z4
        - 3.0 * (nf - 1.0) * (nf - 1.0) / ((nf - 2.0) * (nf - 3.0));
    Ok(Value::Number(k))
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
        assert!((n(&eval("=KURT(3,4,5,2,3,4,5,6,4,7)")) - (-0.15179963720941686)).abs() < 1e-10);
    }

    #[test]
    fn four_equally_spaced() {
        assert!((n(&eval("=KURT(1,2,3,4)")) - (-1.2)).abs() < 1e-12);
    }

    #[test]
    fn symmetric_pairs() {
        assert!((n(&eval("=KURT(1,1,2,2,3,3)")) - (-1.875)).abs() < 1e-12);
    }

    #[test]
    fn fewer_than_four_div_zero() {
        assert_eq!(e(&eval("=KURT(1,2,3)")), CalcError::DivZero);
        assert_eq!(e(&eval("=KURT(5)")), CalcError::DivZero);
    }

    #[test]
    fn zero_variance_div_zero() {
        assert_eq!(e(&eval("=KURT(5,5,5,5)")), CalcError::DivZero);
    }

    #[test]
    fn no_numeric_div_zero() {
        let v = eval_with(&[("A1", "x".into())], "=KURT(A1:A1)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn range_ignores_text() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", "x".into()),
                ("A4", 3.0.into()),
                ("A5", 4.0.into()),
            ],
            "=KURT(A1:A5)",
        );
        assert!((n(&v) - (-1.2)).abs() < 1e-12);
    }

    #[test]
    fn scalar_text_value() {
        assert_eq!(e(&eval("=KURT(\"x\",1,2,3,4)")), CalcError::Value);
    }

    #[test]
    fn scalar_text_coerces() {
        assert!((n(&eval("=KURT(\"4\",1,2,3)")) - (-1.2)).abs() < 1e-12);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("A4", Value::Error(CalcError::NA)),
            ],
            "=KURT(A1:A4)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn normalish_data_near_zero() {
        // Symmetric platykurtic data should be negative-excess.
        assert!(n(&eval("=KURT(1,2,2,3,3,3,4,4,5)")) < 0.0);
    }
}
