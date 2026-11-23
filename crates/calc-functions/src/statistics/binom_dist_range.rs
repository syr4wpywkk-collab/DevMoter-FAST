//! `BINOM.DIST.RANGE(trials, probability_s, number_s, [number_s2])` —
//! probability of a success range `P(k1 <= X <= k2)` (`k2 = k1` when
//! omitted). Spec: `docs/functions/BINOM.DIST.RANGE.md`.
//!
//! Implemented as the direct PMF sum `Σ_{i=k1}^{k2} C(n,i) p^i
//! (1-p)^(n-i)` over [`numerics::ln_binomial_pmf`] — no CDF
//! subtraction, so it never loses the range's mass to cancellation.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 4) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0; 3];
    for (i, out) in nums.iter_mut().enumerate() {
        *out = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let k2 = if args.len() == 4 {
        match coercion::eval_number(ctx, &args[3])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        }
    } else {
        nums[2]
    };
    let n = nums[0].trunc();
    let p = nums[1];
    let k1 = nums[2].trunc();
    let k2 = k2.trunc();
    if n < 0.0 || !(0.0..=1.0).contains(&p) || k1 < 0.0 || k1 > n || k2 < k1 || k2 > n {
        return Ok(Value::Error(CalcError::Num));
    }
    let mut sum = 0.0;
    let mut i = k1;
    while i <= k2 {
        sum += numerics::ln_binomial_pmf(i, n, p).exp();
        i += 1.0;
    }
    if sum.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(sum))
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
    fn single_k_spec_example() {
        let v = n(&eval("=BINOM.DIST.RANGE(10,0.5,6)"));
        assert!((v - 0.205078125).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn range_spec_example() {
        // 0.205078125 + 0.24609375 + 0.205078125
        let v = n(&eval("=BINOM.DIST.RANGE(10,0.5,4,6)"));
        assert!((v - 0.65625).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn full_range_is_one() {
        let v = n(&eval("=BINOM.DIST.RANGE(10,0.5,0,10)"));
        assert!((v - 1.0).abs() < 1e-15, "got {v}");
    }

    #[test]
    fn asymmetric_range() {
        let v = n(&eval("=BINOM.DIST.RANGE(50,0.6,40,50)"));
        assert!((v - 0.002197144757246682).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn k2_below_k1_is_num() {
        assert_eq!(e(&eval("=BINOM.DIST.RANGE(10,0.5,7,3)")), CalcError::Num);
    }

    #[test]
    fn k_above_trials_is_num() {
        assert_eq!(e(&eval("=BINOM.DIST.RANGE(10,0.5,4,11)")), CalcError::Num);
    }

    #[test]
    fn p_out_of_range_is_num() {
        assert_eq!(e(&eval("=BINOM.DIST.RANGE(10,1.5,4,6)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(
            e(&eval(r#"=BINOM.DIST.RANGE(10,0.5,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn truncates_fractional_args() {
        let v = n(&eval("=BINOM.DIST.RANGE(10.9,0.5,6.9)"));
        assert!((v - 0.205078125).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn p_zero_range() {
        // Only k = 0 carries mass.
        assert_eq!(n(&eval("=BINOM.DIST.RANGE(10,0,0,5)")), 1.0);
        assert_eq!(n(&eval("=BINOM.DIST.RANGE(10,0,1,5)")), 0.0);
    }

    #[test]
    fn matches_binom_dist_pmf() {
        let a = n(&eval("=BINOM.DIST.RANGE(20,0.3,8)"));
        let b = n(&eval("=BINOM.DIST(8,20,0.3,FALSE)"));
        assert!((a - b).abs() < 1e-15, "a={a} b={b}");
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(
            e(&eval("=BINOM.DIST.RANGE(10,1/0,4,6)")),
            CalcError::DivZero
        );
    }
}
