//! `NORM.DIST(x, mean, standard_dev, cumulative)` — normal
//! distribution. Spec: `docs/functions/NORM.DIST.md`.

use crate::common::{coercion, numerics};
use crate::statistics::phi::std_normal_pdf;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

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
        std_normal_pdf(z) / sd
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
        // Excel doc: NORM.DIST(42,40,1.5,TRUE) = 0.908789.
        assert!((n(&eval("=NORM.DIST(42,40,1.5,TRUE)")) - 0.90878878).abs() < 1e-7);
    }

    #[test]
    fn doc_example_pdf() {
        assert!((n(&eval("=NORM.DIST(42,40,1.5,FALSE)")) - 0.109340049).abs() < 1e-7);
    }

    #[test]
    fn standard_reduces() {
        assert_eq!(
            n(&eval("=NORM.DIST(1.96,0,1,TRUE)")),
            n(&eval("=NORM.S.DIST(1.96,TRUE)"))
        );
    }

    #[test]
    fn pdf_matches_phi_scaled() {
        // z = (42-40)/1.5; pdf = phi(z)/1.5.
        let want = 0.3989422804014327 * (-0.5 * (4.0f64 / 3.0).powi(2)).exp() / 1.5;
        assert!((n(&eval("=NORM.DIST(42,40,1.5,FALSE)")) - want).abs() < 1e-15);
    }

    #[test]
    fn sd_zero_num() {
        assert_eq!(e(&eval("=NORM.DIST(1,0,0,TRUE)")), CalcError::Num);
    }

    #[test]
    fn sd_negative_num() {
        assert_eq!(e(&eval("=NORM.DIST(1,0,-2,TRUE)")), CalcError::Num);
    }

    #[test]
    fn text_x_value() {
        assert_eq!(e(&eval("=NORM.DIST(\"x\",0,1,TRUE)")), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert_eq!(
            n(&eval("=NORM.DIST(\"42\",40,1.5,TRUE)")),
            n(&eval("=NORM.DIST(42,40,1.5,TRUE)"))
        );
    }

    #[test]
    fn range_inputs() {
        let v = eval_with(
            &[("A1", 42.0.into()), ("B1", 40.0.into()), ("C1", 1.5.into())],
            "=NORM.DIST(A1,B1,C1,TRUE)",
        );
        assert!((n(&v) - 0.90878878).abs() < 1e-7);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=NORM.DIST(1/0,0,1,TRUE)")), CalcError::DivZero);
        assert_eq!(e(&eval("=NORM.DIST(0,1/0,1,TRUE)")), CalcError::DivZero);
        assert_eq!(e(&eval("=NORM.DIST(0,0,1/0,TRUE)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=NORM.DIST(1,0,1)")), CalcError::Value);
    }
}
