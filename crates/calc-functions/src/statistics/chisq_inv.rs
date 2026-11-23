//! `CHISQ.INV(probability, deg_freedom)` — inverse of the left-tailed
//! chi-squared CDF. Spec: `docs/functions/CHISQ.INV.md`.
//!
//! Brent/secant inversion ([`numerics::inverse_cdf`]) of
//! `P(df/2, x/2)` over a grown upper bracket; the Wilson–Hilferty
//! approximation seeds the initial `hi` guess.
//!
//! Boundary policy (SPEC-OPEN in the spec): `p = 0` -> `0`, `p = 1` ->
//! `#NUM!` — the quantile is unbounded and Excel does not return
//! `+∞`.

use super::chisq_dist::{chisq_cdf, valid_df};
use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Invert the left-tailed chi-squared CDF at `p ∈ (0,1)`.
/// `inverse_cdf` needs a finite bracket; `hi` starts at the
/// Wilson–Hilferty estimate and doubles until it brackets `p`.
pub(crate) fn chisq_inv_cdf(p: f64, df: f64) -> f64 {
    // Wilson–Hilferty: x ≈ df·(1 - 2/(9df) + z·sqrt(2/(9df)))³.
    let z = numerics::normal_inv(p);
    let t = 1.0 - 2.0 / (9.0 * df) + z * (2.0 / (9.0 * df)).sqrt();
    let mut hi = (df * t * t * t).max(1.0);
    while chisq_cdf(hi, df) < p {
        hi *= 2.0;
        if !hi.is_finite() {
            return f64::NAN;
        }
    }
    numerics::inverse_cdf(|x| chisq_cdf(x, df), p, 0.0, hi, 1e-12, 200)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let p = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let df = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v.trunc(),
    };
    if !(0.0..=1.0).contains(&p) || !valid_df(df) {
        return Ok(Value::Error(CalcError::Num));
    }
    if p == 0.0 {
        return Ok(Value::Number(0.0));
    }
    if p == 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = chisq_inv_cdf(p, df);
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
    fn spec_example_lower_5pct() {
        let v = n(&eval("=CHISQ.INV(0.05,10)"));
        assert!((v - 3.9402991365242097).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn spec_example_upper_95pct() {
        let v = n(&eval("=CHISQ.INV(0.95,10)"));
        assert!((v - 18.307038053275146).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn round_trip_spec_example() {
        let v = n(&eval("=CHISQ.INV(0.5204998778130465,1)"));
        assert!((v - 0.5).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn negative_p_is_num() {
        assert_eq!(e(&eval("=CHISQ.INV(-0.1,5)")), CalcError::Num);
    }

    #[test]
    fn p_above_one_is_num() {
        assert_eq!(e(&eval("=CHISQ.INV(1.5,5)")), CalcError::Num);
    }

    #[test]
    fn p_zero_is_zero() {
        assert_eq!(n(&eval("=CHISQ.INV(0,5)")), 0.0);
    }

    #[test]
    fn df_out_of_range_is_num() {
        assert_eq!(e(&eval("=CHISQ.INV(0.5,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CHISQ.INV(0.5,1E11)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(e(&eval(r#"=CHISQ.INV("x",5)"#)), CalcError::Value);
    }

    #[test]
    fn truncates_df() {
        let a = n(&eval("=CHISQ.INV(0.5,9.9)"));
        let b = n(&eval("=CHISQ.INV(0.5,9)"));
        assert_eq!(a, b);
    }

    #[test]
    fn round_trip_dist() {
        let x = n(&eval("=CHISQ.INV(0.3,7)"));
        let p = n(&eval(&format!("=CHISQ.DIST({x},7,TRUE)")));
        assert!((p - 0.3).abs() < 1e-9, "x={x} p={p}");
    }

    #[test]
    fn median_df2() {
        // chi2 df=2 median = 2·ln2.
        let v = n(&eval("=CHISQ.INV(0.5,2)"));
        assert!((v - 2.0 * std::f64::consts::LN_2).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=CHISQ.INV(1/0,5)")), CalcError::DivZero);
    }
}
