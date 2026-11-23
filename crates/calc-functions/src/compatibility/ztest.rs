//! `ZTEST(array, x, [sigma])` — legacy one-tailed z-test
//! probability `P(Z >= z)` for `z = (mean(array) - x) /
//! (sigma/sqrt(n))`. Spec: `docs/functions/ZTEST.md`.
//!
//! Identical to `Z.TEST`: omitted `sigma` -> the sample sd of
//! `array`; `sigma <= 0` -> `#NUM!`; empty `array` -> `#N/A`;
//! omitted `sigma` with `n < 2` or zero sd -> `#DIV/0!`. The upper
//! tail uses `erfc` directly for far-tail precision.

use crate::common::{coercion, numerics, statistics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let nums = match coercion::collect_numbers(ctx, &args[0..1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    let x = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let sigma = match args.get(2) {
        Some(Expr::Missing) | None => None,
        Some(a) => match statistics::scalar_number(ctx, a)? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(s) => {
                if s <= 0.0 {
                    return Ok(Value::Error(CalcError::Num));
                }
                Some(s)
            }
        },
    };
    if nums.is_empty() {
        return Ok(Value::Error(CalcError::NA));
    }
    let sd = match sigma {
        Some(s) => s,
        None => match statistics::sample_variance(&nums) {
            Some(v) if v > 0.0 => v.sqrt(),
            _ => return Ok(Value::Error(CalcError::DivZero)),
        },
    };
    let n = nums.len() as f64;
    let mean = nums.iter().sum::<f64>() / n;
    let z = (mean - x) / (sd / n.sqrt());
    Ok(Value::Number(
        0.5 * numerics::erfc(z / std::f64::consts::SQRT_2),
    ))
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

    const A: &str = "{3,6,7,8,6,5,4,2,1,9}";

    #[test]
    fn doc_example_sigma_omitted() {
        // Excel doc: ZTEST(A,4) = 0.090574.
        let v = n(&eval(&format!("=ZTEST({A},4)")));
        assert!((v - 0.090574).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn doc_example_above_half() {
        // Observed mean 5.1 > x=6 fails; value > 0.5.
        let v = n(&eval(&format!("=ZTEST({A},6)")));
        assert!((v - 0.863043).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn doc_example_with_sigma() {
        // 1 - NORMSDIST((5.1-4)/(2/sqrt(10))).
        let v = n(&eval(&format!("=ZTEST({A},4,2)")));
        assert!((v - 0.041002).abs() < 1e-4, "got {v}");
    }

    #[test]
    fn matches_z_test() {
        assert_eq!(
            n(&eval(&format!("=ZTEST({A},4)"))),
            n(&eval(&format!("=Z.TEST({A},4)")))
        );
        assert_eq!(
            n(&eval(&format!("=ZTEST({A},4,2)"))),
            n(&eval(&format!("=Z.TEST({A},4,2)")))
        );
    }

    #[test]
    fn mean_equals_x_is_half() {
        assert_eq!(n(&eval(&format!("=ZTEST({A},5.1,2)"))), 0.5);
    }

    #[test]
    fn empty_array_na() {
        let v = eval_with(&[("A1", Value::Text("x".into()))], "=ZTEST(A1:A3,4)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn nonpositive_sigma_num() {
        assert_eq!(e(&eval(&format!("=ZTEST({A},4,0)"))), CalcError::Num);
        assert_eq!(e(&eval(&format!("=ZTEST({A},4,-1)"))), CalcError::Num);
    }

    #[test]
    fn zero_variance_omitted_sigma_div_zero() {
        assert_eq!(e(&eval("=ZTEST({5,5,5},4)")), CalcError::DivZero);
    }

    #[test]
    fn single_element_omitted_sigma_div_zero() {
        assert_eq!(e(&eval("=ZTEST({5},4)")), CalcError::DivZero);
    }

    #[test]
    fn single_element_with_sigma() {
        // n=1: z = (5-4)/(2/1) = 0.5 -> upper tail ~0.308538.
        let v = n(&eval("=ZTEST({5},4,2)"));
        assert!((v - 0.3085375).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn non_numeric_x_or_sigma_value() {
        assert_eq!(e(&eval(&format!("=ZTEST({A},\"x\")"))), CalcError::Value);
        assert_eq!(e(&eval(&format!("=ZTEST({A},4,\"x\")"))), CalcError::Value);
    }

    #[test]
    fn range_ignores_text() {
        let v = eval_with(
            &[
                ("A1", Value::Number(3.0)),
                ("A2", Value::Text("x".into())),
                ("A3", Value::Number(5.0)),
            ],
            "=ZTEST(A1:A3,4,1)",
        );
        assert_eq!(n(&v), 0.5);
    }

    #[test]
    fn error_in_array_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Ref))], "=ZTEST(A1:A3,4)");
        assert_eq!(e(&v), CalcError::Ref);
    }
}
