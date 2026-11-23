//! `WEIBULL(x, alpha, beta, cumulative)` — legacy Weibull
//! distribution. Spec: `docs/functions/WEIBULL.md`.
//!
//! Identical signature to `WEIBULL.DIST`: CDF
//! `1 - exp(-(x/beta)^alpha)`, PDF
//! `(alpha/beta) · (x/beta)^(alpha-1) · exp(-(x/beta)^alpha)`.
//! `x < 0`, `alpha <= 0` or `beta <= 0` -> `#NUM!`; a non-finite PDF
//! (`x = 0` with `alpha < 1`, or parameter overflow) is `#NUM!` —
//! a recorded spec open question.

use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0f64; 3];
    for (i, slot) in nums.iter_mut().enumerate() {
        match statistics::scalar_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(n) => *slot = n,
        }
    }
    let [x, alpha, beta] = nums;
    if x < 0.0 || alpha <= 0.0 || beta <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let cumulative = match ctx.eval(&args[3])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let t = (x / beta).powf(alpha);
    let v = if cumulative {
        // -expm1 keeps precision when t is tiny.
        -(-t).exp_m1()
    } else {
        (alpha / beta) * (x / beta).powf(alpha - 1.0) * (-t).exp()
    };
    if !v.is_finite() {
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
    fn doc_example_cdf() {
        // Excel doc: WEIBULL(105,20,100,TRUE) = 0.929581.
        let v = n(&eval("=WEIBULL(105,20,100,TRUE)"));
        assert!((v - 0.929581).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn doc_example_pdf() {
        let v = n(&eval("=WEIBULL(105,20,100,FALSE)"));
        assert!((v - 0.035589).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn alpha_one_is_exponential() {
        // WEIBULL(100,1,100,TRUE) = 1 - e^-1.
        let v = n(&eval("=WEIBULL(100,1,100,TRUE)"));
        assert!((v - 0.632120559).abs() < 1e-9);
    }

    #[test]
    fn matches_weibull_dist() {
        assert_eq!(
            n(&eval("=WEIBULL(50,2,80,TRUE)")),
            n(&eval("=WEIBULL.DIST(50,2,80,TRUE)"))
        );
        assert_eq!(
            n(&eval("=WEIBULL(50,2,80,FALSE)")),
            n(&eval("=WEIBULL.DIST(50,2,80,FALSE)"))
        );
    }

    #[test]
    fn x_zero_cdf() {
        assert_eq!(n(&eval("=WEIBULL(0,2,100,TRUE)")), 0.0);
    }

    #[test]
    fn x_zero_pdf_alpha_one() {
        // (1/100) * 0^0 * e^0 = 0.01.
        assert_eq!(n(&eval("=WEIBULL(0,1,100,FALSE)")), 0.01);
    }

    #[test]
    fn negative_x_num() {
        assert_eq!(e(&eval("=WEIBULL(-1,20,100,TRUE)")), CalcError::Num);
    }

    #[test]
    fn nonpositive_params_num() {
        assert_eq!(e(&eval("=WEIBULL(5,0,100,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=WEIBULL(5,-1,100,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=WEIBULL(5,2,0,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=WEIBULL(5,2,-10,TRUE)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=WEIBULL(\"x\",2,100,TRUE)")), CalcError::Value);
        assert_eq!(e(&eval("=WEIBULL(5,\"x\",100,TRUE)")), CalcError::Value);
        assert_eq!(e(&eval("=WEIBULL(5,2,\"x\",TRUE)")), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        let v = n(&eval("=WEIBULL(\"105\",20,100,TRUE)"));
        assert!((v - 0.929581).abs() < 1e-5);
    }

    #[test]
    fn cumulative_in_zero_one() {
        let v = n(&eval("=WEIBULL(30,1.5,80,TRUE)"));
        assert!((0.0..=1.0).contains(&v));
    }

    #[test]
    fn bad_arity() {
        assert!(matches!(eval("=WEIBULL(1,2,3)"), Value::Error(_)));
        assert!(matches!(eval("=WEIBULL(1,2,3,TRUE,4)"), Value::Error(_)));
    }
}
