//! `CONFIDENCE.T(alpha, standard_dev, size)` — confidence-interval
//! half-width using Student's t: `T.INV.2T(alpha, size-1) *
//! standard_dev / SQRT(size)`. Spec: `docs/functions/CONFIDENCE.T.md`.
//!
//! The t CDF is expressed through the regularized incomplete beta
//! (`|T| <= t` ⟺ `I_{df/(df+t²)}(df/2, 1/2)` tail) and inverted with
//! [`numerics::inverse_cdf`]. `size = 1` -> `#NUM!` (df = 0 is
//! undefined; the spec's `#DIV/0!` alternative stays SPEC-OPEN).

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Student t CDF at `t > 0` via the incomplete-beta identity;
/// symmetric around 0.
fn t_cdf(t: f64, df: f64) -> f64 {
    if t == 0.0 {
        return 0.5;
    }
    if t < 0.0 {
        return 1.0 - t_cdf(-t, df);
    }
    let x = df / (df + t * t);
    1.0 - 0.5 * numerics::regularized_beta(x, df / 2.0, 0.5)
}

/// `T.INV.2T(alpha, df)` — the positive `t` with `P(|T| >= t) = alpha`,
/// i.e. the `(1 - alpha/2)` quantile.
///
/// Bisection rather than [`numerics::inverse_cdf`]: that secant solver
/// stalls when the bracket's lower endpoint is in the distribution's
/// flat mid-range (`cdf(0) = 0.5` vs a target like 0.975 — the
/// interpolate overshoots and `a` never moves). 80 halvings are
/// deterministic and give `~1e-20` absolute error on practical
/// brackets.
fn t_inv_2t(alpha: f64, df: f64) -> f64 {
    let target = 1.0 - alpha / 2.0;
    let mut lo = 0.0;
    let mut hi = df.max(1.0);
    while t_cdf(hi, df) < target {
        hi *= 2.0;
        if !hi.is_finite() {
            return f64::NAN;
        }
    }
    for _ in 0..80 {
        let mid = lo + (hi - lo) / 2.0;
        if t_cdf(mid, df) < target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo + (hi - lo) / 2.0
}

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
    let [alpha, sd, size] = nums;
    let size = size.trunc();
    if alpha <= 0.0 || alpha >= 1.0 || sd <= 0.0 || size < 2.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let df = size - 1.0;
    let v = t_inv_2t(alpha, df) * sd / size.sqrt();
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
    fn spec_example_50() {
        // t(0.025,49) = 2.0095752371; *2.5/sqrt(50)
        let v = n(&eval("=CONFIDENCE.T(0.05,2.5,50)"));
        assert!((v - 0.7104921387393258).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn spec_example_10() {
        // t(0.025,9) = 2.2621571628; /sqrt(10)
        let v = n(&eval("=CONFIDENCE.T(0.05,1,10)"));
        assert!((v - 0.7153569059525723).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn spec_example_size2() {
        // t(0.25,1) = 1 -> 1/sqrt(2)
        let v = n(&eval("=CONFIDENCE.T(0.5,1,2)"));
        assert!(
            (v - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-9,
            "got {v}"
        );
    }

    #[test]
    fn spec_example_30() {
        // t(0.005,29) = 2.7563859037; /sqrt(30)
        let v = n(&eval("=CONFIDENCE.T(0.01,1,30)"));
        assert!((v - 0.5032449122230357).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn alpha_bounds_are_num() {
        assert_eq!(e(&eval("=CONFIDENCE.T(0,1,10)")), CalcError::Num);
        assert_eq!(e(&eval("=CONFIDENCE.T(1,1,10)")), CalcError::Num);
    }

    #[test]
    fn sd_nonpositive_is_num() {
        assert_eq!(e(&eval("=CONFIDENCE.T(0.05,0,10)")), CalcError::Num);
    }

    #[test]
    fn size_one_is_num() {
        assert_eq!(e(&eval("=CONFIDENCE.T(0.05,1,1)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_is_value() {
        assert_eq!(e(&eval(r#"=CONFIDENCE.T("x",1,10)"#)), CalcError::Value);
    }

    #[test]
    fn wider_than_norm() {
        // t intervals are wider than normal ones at small df.
        let t = n(&eval("=CONFIDENCE.T(0.05,2.5,5)"));
        let z = n(&eval("=CONFIDENCE.NORM(0.05,2.5,5)"));
        assert!(t > z);
    }

    #[test]
    fn approaches_norm_at_large_df() {
        let t = n(&eval("=CONFIDENCE.T(0.05,1,10000)"));
        let z = n(&eval("=CONFIDENCE.NORM(0.05,1,10000)"));
        assert!((t - z).abs() / z < 1e-3, "t={t} z={z}");
    }

    #[test]
    fn truncates_size() {
        let a = n(&eval("=CONFIDENCE.T(0.05,1,10.9)"));
        let b = n(&eval("=CONFIDENCE.T(0.05,1,10)"));
        assert_eq!(a, b);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=CONFIDENCE.T(0.05,1,1/0)")), CalcError::DivZero);
    }
}
