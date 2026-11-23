//! `NORM.S.DIST(z, cumulative)` — standard normal distribution.
//! Spec: `docs/functions/NORM.S.DIST.md`.

use crate::common::{coercion, numerics};
use crate::statistics::phi::std_normal_pdf;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let z = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(z) => z,
    };
    let cumulative = match ctx.eval(&args[1])?.to_boolean() {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    Ok(Value::Number(if cumulative {
        numerics::normal_cdf(z)
    } else {
        std_normal_pdf(z)
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
    fn cdf_at_zero() {
        assert_eq!(n(&eval("=NORM.S.DIST(0,TRUE)")), 0.5);
    }

    #[test]
    fn doc_example_cdf() {
        // Excel doc: NORM.S.DIST(1.333333, TRUE) = 0.908789.
        assert!((n(&eval("=NORM.S.DIST(1.333333,TRUE)")) - 0.908788726).abs() < 1e-7);
    }

    #[test]
    fn doc_example_pdf() {
        assert!((n(&eval("=NORM.S.DIST(1.333333,FALSE)")) - 0.164010148).abs() < 1e-7);
    }

    #[test]
    fn pdf_at_zero() {
        assert!((n(&eval("=NORM.S.DIST(0,FALSE)")) - 0.3989422804014327).abs() < 1e-15);
    }

    #[test]
    fn left_tail() {
        assert!((n(&eval("=NORM.S.DIST(-1.96,TRUE)")) - 0.024997895).abs() < 1e-7);
    }

    #[test]
    fn symmetry() {
        let lo = n(&eval("=NORM.S.DIST(-0.3,TRUE)"));
        let hi = n(&eval("=NORM.S.DIST(0.3,TRUE)"));
        assert!((lo + hi - 1.0).abs() < 1e-15);
    }

    #[test]
    fn extreme_z_saturates() {
        assert_eq!(n(&eval("=NORM.S.DIST(-40,TRUE)")), 0.0);
        assert_eq!(n(&eval("=NORM.S.DIST(40,TRUE)")), 1.0);
    }

    #[test]
    fn cumulative_numeric_coercion() {
        assert_eq!(n(&eval("=NORM.S.DIST(0,1)")), 0.5);
        assert!((n(&eval("=NORM.S.DIST(0,0)")) - 0.3989422804014327).abs() < 1e-15);
    }

    #[test]
    fn range_z() {
        let v = eval_with(&[("A1", 1.96.into())], "=NORM.S.DIST(A1,TRUE)");
        assert!((n(&v) - 0.9750021048517796).abs() < 1e-12);
    }

    #[test]
    fn text_z_is_value() {
        assert_eq!(e(&eval("=NORM.S.DIST(\"x\",TRUE)")), CalcError::Value);
    }

    #[test]
    fn text_cumulative_is_value() {
        assert_eq!(e(&eval("=NORM.S.DIST(0,\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=NORM.S.DIST(1/0,TRUE)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=NORM.S.DIST(0)")), CalcError::Value);
        assert_eq!(e(&eval("=NORM.S.DIST(0,TRUE,1)")), CalcError::Value);
    }
}
