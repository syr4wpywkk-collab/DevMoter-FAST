//! `NORMDIST(x, mean, standard_dev, cumulative)` — legacy normal
//! distribution PDF or CDF. Spec: `docs/functions/NORMDIST.md`.
//!
//! Identical signature and semantics to `NORM.DIST`; the standard
//! normal CDF/PDF kernels are `numerics::normal_cdf` and the
//! `phi` density `exp(-z^2/2) / sqrt(2*pi)`.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

const SQRT_2PI: f64 = 2.50662827463100050241576528481104525;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
        return Ok(Value::Error(e));
    }
    let mut nums = [0.0; 3];
    for (i, slot) in nums.iter_mut().enumerate() {
        *slot = match coercion::eval_number(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(v) => v,
        };
    }
    let [x, mean, sd] = nums;
    if sd <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let cumulative = match ctx.eval(&args[3])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let z = (x - mean) / sd;
    Ok(Value::Number(if cumulative {
        numerics::normal_cdf(z)
    } else {
        (-0.5 * z * z).exp() / (SQRT_2PI * sd)
    }))
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
        // Excel doc: NORMDIST(42,40,1.5,TRUE) = 0.908789.
        assert!((n(&eval("=NORMDIST(42,40,1.5,TRUE)")) - 0.90878878).abs() < 1e-7);
    }

    #[test]
    fn doc_example_pdf() {
        assert!((n(&eval("=NORMDIST(42,40,1.5,FALSE)")) - 0.109340049).abs() < 1e-7);
    }

    #[test]
    fn cdf_at_mean() {
        assert_eq!(n(&eval("=NORMDIST(40,40,1.5,TRUE)")), 0.5);
    }

    #[test]
    fn matches_norm_dist() {
        assert_eq!(
            n(&eval("=NORMDIST(1.96,0,1,TRUE)")),
            n(&eval("=NORM.DIST(1.96,0,1,TRUE)"))
        );
        let a = n(&eval("=NORMDIST(1.96,0,1,FALSE)"));
        let b = n(&eval("=NORM.DIST(1.96,0,1,FALSE)"));
        assert!((a - b).abs() < 1e-15, "{a} vs {b}");
    }

    #[test]
    fn standard_reduces_to_normsdist() {
        assert_eq!(
            n(&eval("=NORMDIST(0.5,0,1,TRUE)")),
            n(&eval("=NORMSDIST(0.5)"))
        );
    }

    #[test]
    fn negative_sd_num() {
        assert_eq!(e(&eval("=NORMDIST(0,0,-1,TRUE)")), CalcError::Num);
        assert_eq!(e(&eval("=NORMDIST(0,0,0,TRUE)")), CalcError::Num);
    }

    #[test]
    fn far_tail_saturates() {
        assert_eq!(n(&eval("=NORMDIST(-40,0,1,TRUE)")), 0.0);
        assert_eq!(n(&eval("=NORMDIST(40,0,1,TRUE)")), 1.0);
    }

    #[test]
    fn cumulative_false_at_zero() {
        // phi(0) / 1 = 1/sqrt(2*pi)
        let v = n(&eval("=NORMDIST(0,0,1,FALSE)"));
        assert!((v - 0.3989422804014327).abs() < 1e-15);
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=NORMDIST(\"x\",0,1,TRUE)")), CalcError::Value);
        assert_eq!(e(&eval("=NORMDIST(0,\"x\",1,TRUE)")), CalcError::Value);
        assert_eq!(e(&eval("=NORMDIST(0,0,\"x\",TRUE)")), CalcError::Value);
    }

    #[test]
    fn text_and_bool_coercion() {
        assert_eq!(
            n(&eval("=NORMDIST(\"1\",0,1,TRUE)")),
            n(&eval("=NORMSDIST(1)"))
        );
        assert_eq!(
            n(&eval("=NORMDIST(1,0,1,TRUE)")),
            n(&eval("=NORMDIST(TRUE,0,1,TRUE)"))
        );
    }

    #[test]
    fn bad_arity() {
        assert!(matches!(eval("=NORMDIST(1,0,1)"), Value::Error(_)));
        assert!(matches!(eval("=NORMDIST(1,0,1,TRUE,2)"), Value::Error(_)));
    }
}
