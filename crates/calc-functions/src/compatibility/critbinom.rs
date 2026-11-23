//! `CRITBINOM(trials, probability_s, alpha)` — legacy inverse binomial
//! CDF: smallest `k` with `P(X <= k) >= alpha`; equivalent to
//! `BINOM.INV`. Spec: `docs/functions/CRITBINOM.md`.
//!
//! Scans `k = 0..=n` accumulating the PMF — the running sum stays
//! exact, avoiding edge effects a `regularized_beta` inverse would
//! have near `p` = 0/1.

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
    fn spec_example() {
        assert_eq!(n(&eval("=CRITBINOM(6,0.5,0.75)")), 4.0);
    }

    #[test]
    fn spec_example_half() {
        // CDF(4)=0.376953 < 0.5 <= CDF(5)=0.623047.
        assert_eq!(n(&eval("=CRITBINOM(10,0.5,0.5)")), 5.0);
    }

    #[test]
    fn alpha_zero_gives_zero() {
        // CDF(0) > 0 already satisfies >= 0.
        assert_eq!(n(&eval("=CRITBINOM(10,0.5,0)")), 0.0);
    }

    #[test]
    fn alpha_one_gives_trials() {
        assert_eq!(n(&eval("=CRITBINOM(10,0.5,1)")), 10.0);
    }

    #[test]
    fn negative_trials_num() {
        assert_eq!(e(&eval("=CRITBINOM(-1,0.5,0.5)")), CalcError::Num);
    }

    #[test]
    fn p_outside_num() {
        assert_eq!(e(&eval("=CRITBINOM(10,-0.1,0.5)")), CalcError::Num);
        assert_eq!(e(&eval("=CRITBINOM(10,1.1,0.5)")), CalcError::Num);
    }

    #[test]
    fn alpha_outside_num() {
        assert_eq!(e(&eval("=CRITBINOM(10,0.5,-0.1)")), CalcError::Num);
        assert_eq!(e(&eval("=CRITBINOM(10,0.5,1.1)")), CalcError::Num);
    }

    #[test]
    fn trials_truncated() {
        // 6.9 -> 6.
        assert_eq!(n(&eval("=CRITBINOM(6.9,0.5,0.75)")), 4.0);
    }

    #[test]
    fn p_zero() {
        // Only k=0 has mass... CDF(0)=1 already, so result is 0.
        assert_eq!(n(&eval("=CRITBINOM(10,0,0.5)")), 0.0);
    }

    #[test]
    fn text_arg_value() {
        assert_eq!(e(&eval(r#"=CRITBINOM("x",0.5,0.5)"#)), CalcError::Value);
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=CRITBINOM(20,0.4,0.6)"));
        let b = n(&eval("=BINOM.INV(20,0.4,0.6)"));
        assert_eq!(a, b);
    }
}
