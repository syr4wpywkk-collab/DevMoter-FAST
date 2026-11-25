//! `WEIBULL.DIST(x, alpha, beta, cumulative)` — Weibull distribution.
//! Spec: `docs/functions/WEIBULL.DIST.md`.
//!
//! CDF `1 - exp(-(x/beta)^alpha)`; PDF
//! `(alpha/beta) * (x/beta)^(alpha-1) * exp(-(x/beta)^alpha)`.
//! `x < 0`, `alpha <= 0` or `beta <= 0` -> `#NUM!`. A non-finite PDF
//! (`x = 0` with `alpha < 1`, or parameter overflow) is `#NUM!` —
//! SPEC-OPEN vs Excel's behavior, noted in the spec doc.

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
    fn excel_doc_cdf() {
        // Excel doc: WEIBULL.DIST(105,20,100,TRUE) = 0.929581
        let v = n(&eval("=WEIBULL.DIST(105,20,100,TRUE)"));
        assert!((v - 0.9295813901).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn excel_doc_pdf() {
        // Excel doc: WEIBULL.DIST(105,20,100,FALSE) = 0.035589
        let v = n(&eval("=WEIBULL.DIST(105,20,100,FALSE)"));
        assert!((v - 0.0355888640).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn zero_x_cdf() {
        assert_eq!(n(&eval("=WEIBULL.DIST(0,1,2,TRUE)")), 0.0);
    }

    #[test]
    fn exponential_case() {
        // alpha=1: WEIBULL.DIST(2,1,2,TRUE) = 1 - e^-1
        let v = n(&eval("=WEIBULL.DIST(2,1,2,TRUE)"));
        assert!((v - 0.6321205588).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn x_zero_alpha_one_pdf() {
        // alpha=1, x=0 -> exponential density 1/beta = 0.5
        let v = n(&eval("=WEIBULL.DIST(0,1,2,FALSE)"));
        assert!((v - 0.5).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn x_zero_alpha_below_one_pdf_num() {
        // Divergent density -> #NUM! (SPEC-OPEN choice; see file docs).
        assert_eq!(e(&eval("=WEIBULL.DIST(0,0.5,2,FALSE)")), CalcError::Num);
    }

    #[test]
    fn negative_x_num() {
        assert_eq!(e(&eval("=WEIBULL.DIST(-1,1,2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn alpha_zero_num() {
        assert_eq!(e(&eval("=WEIBULL.DIST(1,0,2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn beta_negative_num() {
        assert_eq!(e(&eval("=WEIBULL.DIST(1,1,-2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn numeric_cumulative_coerces() {
        assert_eq!(n(&eval("=WEIBULL.DIST(0,1,2,1)")), 0.0);
    }

    #[test]
    fn non_numeric_arg_value() {
        assert_eq!(e(&eval(r#"=WEIBULL.DIST("x",1,2,TRUE)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=WEIBULL.DIST(1/0,1,2,TRUE)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=WEIBULL.DIST(1,1,2)")), CalcError::Value);
    }
}
