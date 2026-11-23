//! `BETA.DIST(x, alpha, beta, cumulative, [A], [B])` — beta PDF/CDF over
//! `[A,B]` (default `[0,1]`). Spec: `docs/functions/BETA.DIST.md`.
//!
//! `x` is standardized to `z = (x - A)/(B - A)`; the CDF is
//! `I_z(alpha, beta)` ([`numerics::regularized_beta`]). The PDF is the
//! standard beta density at `z` divided by `B - A` (true density on
//! `[A,B]` — the spec marks the rescaling question SPEC-OPEN; this is
//! the mathematically consistent choice).

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Standard beta density at `z ∈ [0,1]` (edge limits handled).
fn beta_pdf(z: f64, a: f64, b: f64) -> f64 {
    let ln_beta_ab = numerics::ln_gamma(a) + numerics::ln_gamma(b) - numerics::ln_gamma(a + b);
    if z == 0.0 {
        return if a < 1.0 {
            f64::INFINITY
        } else if a == 1.0 {
            (-ln_beta_ab).exp()
        } else {
            0.0
        };
    }
    if z == 1.0 {
        return if b < 1.0 {
            f64::INFINITY
        } else if b == 1.0 {
            (-ln_beta_ab).exp()
        } else {
            0.0
        };
    }
    ((a - 1.0) * z.ln() + (b - 1.0) * (1.0 - z).ln() - ln_beta_ab).exp()
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 6) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0; 3];
    for (i, out) in nums.iter_mut().enumerate() {
        *out = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let [x, alpha, beta] = nums;
    let cumulative = match ctx.eval(&args[3])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let (mut lo, mut hi) = (0.0, 1.0);
    for (i, out) in [(4, &mut lo), (5, &mut hi)] {
        if args.len() > i {
            *out = match coercion::eval_number(ctx, &args[i])? {
                Err(e) => return Ok(Value::Error(e)),
                Ok(v) => v,
            };
        }
    }

    if alpha <= 0.0 || beta <= 0.0 || lo == hi {
        return Ok(Value::Error(CalcError::Num));
    }
    let z = (x - lo) / (hi - lo);
    if !(0.0..=1.0).contains(&z) {
        // Also catches NaN `x`/`z`.
        return Ok(Value::Error(CalcError::Num));
    }
    let v = if cumulative {
        numerics::regularized_beta(z, alpha, beta)
    } else {
        beta_pdf(z, alpha, beta) / (hi - lo)
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
    fn cdf_spec_example() {
        let v = n(&eval("=BETA.DIST(0.5,2,3,TRUE)"));
        assert!((v - 0.6875).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn pdf_spec_example() {
        let v = n(&eval("=BETA.DIST(0.5,2,3,FALSE)"));
        assert!((v - 1.5).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn cdf_with_bounds() {
        let v = n(&eval("=BETA.DIST(2,8,10,TRUE,1,3)"));
        assert!((v - 0.6854705810547407).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn alpha_zero_num() {
        assert_eq!(e(&eval("=BETA.DIST(0.5,0,1,TRUE)")), CalcError::Num);
    }

    #[test]
    fn beta_negative_num() {
        assert_eq!(e(&eval("=BETA.DIST(0.5,1,-1,TRUE)")), CalcError::Num);
    }

    #[test]
    fn x_above_b_num() {
        assert_eq!(e(&eval("=BETA.DIST(1.5,1,1,TRUE,0,1)")), CalcError::Num);
    }

    #[test]
    fn x_below_a_num() {
        assert_eq!(e(&eval("=BETA.DIST(-0.5,1,1,TRUE)")), CalcError::Num);
    }

    #[test]
    fn a_equals_b_num() {
        assert_eq!(e(&eval("=BETA.DIST(1,2,2,TRUE,1,1)")), CalcError::Num);
    }

    #[test]
    fn uniform_distribution() {
        // Beta(1,1) is uniform: CDF = x, PDF = 1.
        let c = n(&eval("=BETA.DIST(0.3,1,1,TRUE)"));
        assert!((c - 0.3).abs() < 1e-12, "got {c}");
        let p = n(&eval("=BETA.DIST(0.3,1,1,FALSE)"));
        assert!((p - 1.0).abs() < 1e-12, "got {p}");
    }

    #[test]
    fn endpoints() {
        assert_eq!(n(&eval("=BETA.DIST(0,2,3,TRUE)")), 0.0);
        assert_eq!(n(&eval("=BETA.DIST(1,2,3,TRUE)")), 1.0);
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(e(&eval(r#"=BETA.DIST("x",2,3,TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn cumulative_accepts_number() {
        // cumulative coerces as a logical: 0 -> FALSE (PDF), 1 -> TRUE.
        let c = n(&eval("=BETA.DIST(0.5,2,3,1)"));
        assert!((c - 0.6875).abs() < 1e-12, "got {c}");
        let p = n(&eval("=BETA.DIST(0.5,2,3,0)"));
        assert!((p - 1.5).abs() < 1e-12, "got {p}");
    }

    #[test]
    fn pdf_rescaled_on_interval() {
        // True density on [0,2] for uniform: 1/(B-A) = 0.5.
        let v = n(&eval("=BETA.DIST(1,1,1,FALSE,0,2)"));
        assert!((v - 0.5).abs() < 1e-12, "got {v}");
    }
}
