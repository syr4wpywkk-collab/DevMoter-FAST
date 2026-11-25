//! `BINOM.INV(trials, probability_s, alpha)` — smallest `k` with
//! `P(X <= k) >= alpha` (inverse binomial CDF; legacy `CRITBINOM`).
//! Spec: `docs/functions/BINOM.INV.md`.
//!
//! Scans `k = 0..=n` accumulating the PMF — O(n) but the running sum
//! stays exact, avoiding edge effects a `regularized_beta` inverse
//! would have near `p` = 0/1.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0; 3];
    for (i, out) in nums.iter_mut().enumerate() {
        *out = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let n = nums[0].trunc();
    let p = nums[1];
    let alpha = nums[2];
    if n < 0.0 || !(0.0..=1.0).contains(&p) || !(0.0..=1.0).contains(&alpha) {
        return Ok(Value::Error(CalcError::Num));
    }
    let mut cdf = 0.0;
    let mut k = 0.0;
    while k <= n {
        cdf += numerics::ln_binomial_pmf(k, n, p).exp();
        if cdf >= alpha {
            return Ok(Value::Number(k));
        }
        k += 1.0;
    }
    // Accumulated rounding may leave cdf a hair below alpha = 1.
    Ok(Value::Number(n))
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
    fn spec_example_half() {
        assert_eq!(n(&eval("=BINOM.INV(10,0.5,0.5)")), 5.0);
    }

    #[test]
    fn spec_example_just_above_cdf() {
        // CDF(6) = 0.828125 < 0.83 -> 7.
        assert_eq!(n(&eval("=BINOM.INV(10,0.5,0.83)")), 7.0);
    }

    #[test]
    fn spec_example_below_cdf() {
        // CDF(6) = 0.828125 >= 0.82 -> 6.
        assert_eq!(n(&eval("=BINOM.INV(10,0.5,0.82)")), 6.0);
    }

    #[test]
    fn spec_example_small() {
        assert_eq!(n(&eval("=BINOM.INV(6,0.5,0.75)")), 4.0);
    }

    #[test]
    fn alpha_one_returns_trials() {
        assert_eq!(n(&eval("=BINOM.INV(10,0.5,1)")), 10.0);
    }

    #[test]
    fn alpha_zero_returns_zero() {
        assert_eq!(n(&eval("=BINOM.INV(10,0.5,0)")), 0.0);
    }

    #[test]
    fn p_out_of_range_is_num() {
        assert_eq!(e(&eval("=BINOM.INV(10,1.5,0.5)")), CalcError::Num);
        assert_eq!(e(&eval("=BINOM.INV(10,-0.5,0.5)")), CalcError::Num);
    }

    #[test]
    fn alpha_out_of_range_is_num() {
        assert_eq!(e(&eval("=BINOM.INV(10,0.5,-0.1)")), CalcError::Num);
        assert_eq!(e(&eval("=BINOM.INV(10,0.5,1.1)")), CalcError::Num);
    }

    #[test]
    fn negative_trials_is_num() {
        assert_eq!(e(&eval("=BINOM.INV(-2,0.5,0.5)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(e(&eval(r#"=BINOM.INV("x",0.5,0.5)"#)), CalcError::Value);
    }

    #[test]
    fn p_zero_returns_zero() {
        // All mass at k = 0: CDF(0) = 1 >= any alpha.
        assert_eq!(n(&eval("=BINOM.INV(10,0,0.9)")), 0.0);
    }

    #[test]
    fn truncates_trials() {
        assert_eq!(n(&eval("=BINOM.INV(10.9,0.5,0.5)")), 5.0);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=BINOM.INV(10,0.5,1/0)")), CalcError::DivZero);
    }
}
