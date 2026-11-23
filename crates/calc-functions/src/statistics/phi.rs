//! `PHI(x)` — standard normal density `exp(-x²/2)/√(2π)` (the PDF,
//! despite the name). Spec: `docs/functions/PHI.md`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Standard normal PDF, shared with `NORM.S.DIST(z, FALSE)`.
pub(crate) fn std_normal_pdf(z: f64) -> f64 {
    const INV_SQRT_2PI: f64 = 0.398_942_280_401_432_7;
    INV_SQRT_2PI * (-0.5 * z * z).exp()
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match coercion::eval_number(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(x) => Ok(Value::Number(std_normal_pdf(x))),
    }
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
    fn at_zero() {
        assert!((n(&eval("=PHI(0)")) - 0.3989422804014327).abs() < 1e-15);
    }

    #[test]
    fn doc_example() {
        assert!((n(&eval("=PHI(0.75)")) - 0.3011374321548044).abs() < 1e-12);
    }

    #[test]
    fn negative_symmetric() {
        assert_eq!(n(&eval("=PHI(-1)")), n(&eval("=PHI(1)")));
        assert!((n(&eval("=PHI(-1)")) - 0.24197072451914337).abs() < 1e-15);
    }

    #[test]
    fn far_tail_underflows() {
        assert_eq!(n(&eval("=PHI(40)")), 0.0);
    }

    #[test]
    fn matches_norm_s_dist_pdf() {
        assert_eq!(
            n(&eval("=PHI(1.234)")),
            n(&eval("=NORM.S.DIST(1.234,FALSE)"))
        );
    }

    #[test]
    fn numeric_text_coerces() {
        assert!((n(&eval("=PHI(\"0.75\")")) - 0.3011374321548044).abs() < 1e-12);
    }

    #[test]
    fn boolean_coerces() {
        assert!((n(&eval("=PHI(TRUE)")) - 0.24197072451914337).abs() < 1e-15);
    }

    #[test]
    fn blank_arg_zero() {
        // Blank scalar coerces to 0 -> pdf at 0.
        assert!((n(&eval("=PHI(A1)")) - 0.3989422804014327).abs() < 1e-15);
    }

    #[test]
    fn text_is_value_error() {
        assert_eq!(e(&eval("=PHI(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=PHI(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=PHI()")), CalcError::Value);
        assert_eq!(e(&eval("=PHI(1,2)")), CalcError::Value);
    }
}
