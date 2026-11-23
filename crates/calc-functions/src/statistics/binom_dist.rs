//! `BINOM.DIST(number_s, trials, probability_s, cumulative)` — binomial
//! PMF `P(X = k)` or left-tailed CDF `P(X <= k)`. Spec:
//! `docs/functions/BINOM.DIST.md`.
//!
//! `number_s`/`trials` truncate toward zero before the range checks
//! (the spec's open question on order; truncation-first matches the
//! documented `k = 10.9, trials = 10` acceptance). The CDF uses the
//! regularized incomplete beta identity
//! `P(X <= k) = I_{1-p}(n-k, k+1)` for stability; the `p = 0`/`p = 1`
//! degenerate cases are handled explicitly.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Left-tailed binomial probability `P(X <= k)` for `X ~ Bin(n, p)`,
/// with `0 <= k <= n` already enforced.
pub(crate) fn binomial_cdf(k: f64, n: f64, p: f64) -> f64 {
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
    fn pmf_spec_example() {
        let v = n(&eval("=BINOM.DIST(6,10,0.5,FALSE)"));
        assert!((v - 0.205078125).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn cdf_spec_example() {
        let v = n(&eval("=BINOM.DIST(6,10,0.5,TRUE)"));
        assert!((v - 0.828125).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn pmf_asymmetric() {
        let v = n(&eval("=BINOM.DIST(48,50,0.6,FALSE)"));
        assert!((v - 4.400642510641486e-9).abs() < 1e-15, "got {v}");
    }

    #[test]
    fn k_above_trials_is_num() {
        assert_eq!(e(&eval("=BINOM.DIST(11,10,0.5,FALSE)")), CalcError::Num);
    }

    #[test]
    fn p_out_of_range_is_num() {
        assert_eq!(e(&eval("=BINOM.DIST(2,5,1.5,FALSE)")), CalcError::Num);
        assert_eq!(e(&eval("=BINOM.DIST(2,5,-0.1,FALSE)")), CalcError::Num);
    }

    #[test]
    fn negative_trials_is_num() {
        assert_eq!(e(&eval("=BINOM.DIST(1,-3,0.5,FALSE)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(
            e(&eval(r#"=BINOM.DIST("x",10,0.5,FALSE)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn truncates_fractional_args() {
        // 6.9 -> 6, 10.9 -> 10: same as (6,10).
        let v = n(&eval("=BINOM.DIST(6.9,10.9,0.5,FALSE)"));
        assert!((v - 0.205078125).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn fractional_k_inside_trials_truncates_then_passes() {
        // k = 10.9 truncates to 10 which is <= trials = 10.
        let v = n(&eval("=BINOM.DIST(10.9,10,0.5,FALSE)"));
        assert!((v - 0.0009765625).abs() < 1e-15, "got {v}");
    }

    #[test]
    fn p_zero_pmf() {
        assert_eq!(n(&eval("=BINOM.DIST(0,10,0,FALSE)")), 1.0);
        assert_eq!(n(&eval("=BINOM.DIST(3,10,0,FALSE)")), 0.0);
    }

    #[test]
    fn p_one_cdf() {
        assert_eq!(n(&eval("=BINOM.DIST(9,10,1,TRUE)")), 0.0);
        assert_eq!(n(&eval("=BINOM.DIST(10,10,1,TRUE)")), 1.0);
    }

    #[test]
    fn cdf_at_trials_is_one() {
        assert_eq!(n(&eval("=BINOM.DIST(10,10,0.3,TRUE)")), 1.0);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(
            e(&eval("=BINOM.DIST(1/0,10,0.5,FALSE)")),
            CalcError::DivZero
        );
    }
}
