//! `BINOMDIST(number_s, trials, probability_s, cumulative)` — legacy
//! binomial PMF/CDF; equivalent to `BINOM.DIST`. Spec:
//! `docs/functions/BINOMDIST.md`.
//!
//! `number_s`/`trials` truncate before the range checks; the CDF uses
//! the `I_{1-p}(n-k, k+1)` identity for stability.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Left-tailed binomial probability `P(X <= k)` for `X ~ Bin(n, p)`.
fn binomial_cdf(k: f64, n: f64, p: f64) -> f64 {
    if p == 0.0 {
        return 1.0;
    }
    if p == 1.0 {
        return if k >= n { 1.0 } else { 0.0 };
    }
    if k >= n {
        return 1.0;
    }
    numerics::regularized_beta(1.0 - p, n - k, k + 1.0)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0; 3];
    for (i, out) in nums.iter_mut().enumerate() {
        *out = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let cumulative = match ctx.eval(&args[3])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let k = nums[0].trunc();
    let n = nums[1].trunc();
    let p = nums[2];
    if k < 0.0 || k > n || n < 0.0 || !(0.0..=1.0).contains(&p) {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = if cumulative {
        binomial_cdf(k, n, p)
    } else {
        numerics::ln_binomial_pmf(k, n, p).exp()
    };
    if v.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(v))
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
    fn spec_example_pmf() {
        assert!((n(&eval("=BINOMDIST(3,10,0.5,FALSE)")) - 0.1171875).abs() < 1e-12);
    }

    #[test]
    fn spec_example_cdf() {
        assert!((n(&eval("=BINOMDIST(2,10,0.5,TRUE)")) - 0.0546875).abs() < 1e-12);
    }

    #[test]
    fn spec_example_pmf_six() {
        assert!((n(&eval("=BINOMDIST(6,10,0.5,FALSE)")) - 0.205078125).abs() < 1e-12);
    }

    #[test]
    fn k_above_trials_num() {
        assert_eq!(e(&eval("=BINOMDIST(11,10,0.5,FALSE)")), CalcError::Num);
    }

    #[test]
    fn p_outside_num() {
        assert_eq!(e(&eval("=BINOMDIST(1,10,-0.1,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=BINOMDIST(1,10,1.1,TRUE)")), CalcError::Num);
    }

    #[test]
    fn negative_k_num() {
        assert_eq!(e(&eval("=BINOMDIST(-1,10,0.5,TRUE)")), CalcError::Num);
    }

    #[test]
    fn truncation() {
        // 3.9 truncates to 3.
        assert!((n(&eval("=BINOMDIST(3.9,10,0.5,FALSE)")) - 0.1171875).abs() < 1e-12);
    }

    #[test]
    fn p_zero_and_one() {
        assert!((n(&eval("=BINOMDIST(0,10,0,FALSE)")) - 1.0).abs() < 1e-12);
        assert_eq!(n(&eval("=BINOMDIST(5,10,0,TRUE)")), 1.0);
        assert!((n(&eval("=BINOMDIST(10,10,1,FALSE)")) - 1.0).abs() < 1e-12);
        assert_eq!(n(&eval("=BINOMDIST(5,10,1,TRUE)")), 0.0);
    }

    #[test]
    fn cumulative_numeric_zero_is_false() {
        assert!((n(&eval("=BINOMDIST(3,10,0.5,0)")) - 0.1171875).abs() < 1e-12);
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=BINOMDIST("x",10,0.5,TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=BINOMDIST(4,12,0.3,TRUE)"));
        let b = n(&eval("=BINOM.DIST(4,12,0.3,TRUE)"));
        assert_eq!(a, b);
    }
}
