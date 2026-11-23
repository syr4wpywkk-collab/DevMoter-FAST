//! `NEGBINOMDIST(number_f, number_s, probability_s)` — legacy negative
//! binomial point probability. Spec: `docs/functions/NEGBINOMDIST.md`.
//!
//! Always the PMF (no cumulative argument — that is the legacy
//! difference vs `NEGBINOM.DIST`): `C(f+s-1, s-1) · p^s · (1-p)^f`
//! with `number_f`/`number_s` truncated. The `p = 0`/`p = 1`
//! boundaries follow the closed form (`p=0` -> 0 since `s >= 1`;
//! `p=1` -> 1 iff `f = 0`); the `p=0, f=0` corner is a recorded
//! open question in the spec.

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
    for (i, slot) in nums.iter_mut().enumerate() {
        *slot = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let [f, s, p] = [nums[0].trunc(), nums[1].trunc(), nums[2]];
    if f < 0.0 || s < 1.0 || !(0.0..=1.0).contains(&p) {
        return Ok(Value::Error(CalcError::Num));
    }
    let out = if p == 0.0 {
        0.0 // s >= 1 -> p^s = 0
    } else if p == 1.0 {
        if f == 0.0 { 1.0 } else { 0.0 }
    } else {
        (numerics::ln_choose(f + s - 1.0, s - 1.0) + s * p.ln() + f * (1.0 - p).ln()).exp()
    };
    Ok(Value::Number(out))
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
    fn doc_example() {
        // Excel doc: NEGBINOMDIST(10,5,0.25) = 0.055049.
        let v = n(&eval("=NEGBINOMDIST(10,5,0.25)"));
        assert!((v - 0.0550486603).abs() < 1e-7, "got {v}");
    }

    #[test]
    fn first_trial_success() {
        assert!((n(&eval("=NEGBINOMDIST(0,1,0.5)")) - 0.5).abs() < 1e-15);
    }

    #[test]
    fn p_one_zero_failures() {
        assert_eq!(n(&eval("=NEGBINOMDIST(0,5,1)")), 1.0);
    }

    #[test]
    fn p_one_with_failures() {
        assert_eq!(n(&eval("=NEGBINOMDIST(2,5,1)")), 0.0);
    }

    #[test]
    fn p_zero() {
        assert_eq!(n(&eval("=NEGBINOMDIST(3,2,0)")), 0.0);
    }

    #[test]
    fn truncates_counts() {
        assert_eq!(
            n(&eval("=NEGBINOMDIST(10.9,5.7,0.25)")),
            n(&eval("=NEGBINOMDIST(10,5,0.25)"))
        );
    }

    #[test]
    fn matches_modern_pmf() {
        assert_eq!(
            n(&eval("=NEGBINOMDIST(7,3,0.4)")),
            n(&eval("=NEGBINOM.DIST(7,3,0.4,FALSE)"))
        );
    }

    #[test]
    fn negative_failures_num() {
        assert_eq!(e(&eval("=NEGBINOMDIST(-1,5,0.5)")), CalcError::Num);
    }

    #[test]
    fn number_s_below_one_num() {
        assert_eq!(e(&eval("=NEGBINOMDIST(5,0.9,0.5)")), CalcError::Num);
    }

    #[test]
    fn p_out_of_range_num() {
        assert_eq!(e(&eval("=NEGBINOMDIST(5,2,1.5)")), CalcError::Num);
        assert_eq!(e(&eval("=NEGBINOMDIST(5,2,-0.1)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=NEGBINOMDIST(\"x\",2,0.5)")), CalcError::Value);
    }

    #[test]
    fn boolean_and_text_coercion() {
        assert!((n(&eval("=NEGBINOMDIST(TRUE,2,0.5)")) - 0.25).abs() < 1e-15);
        assert!((n(&eval("=NEGBINOMDIST(2,2,\"0.5\")")) - 0.1875).abs() < 1e-15);
    }
}
