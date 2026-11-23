//! `TAN(number)` — tangent of an angle in radians. Spec:
//! `docs/functions/TAN.md`.
//!
//! Near odd multiples of pi/2 the f64 result is huge but finite — no
//! error. SPEC-OPEN: large-argument domain policy shared with `SIN`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match coercion::eval_number(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(x) => Ok(Value::Number(x.tan())),
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
    fn tan_zero() {
        assert_eq!(n(&eval("=TAN(0)")), 0.0);
    }

    #[test]
    fn tan_spec_value() {
        assert!((n(&eval("=TAN(0.785)")) - 0.99920).abs() < 1e-4);
    }

    #[test]
    fn tan_45_deg() {
        assert!((n(&eval("=TAN(45*PI()/180)")) - 1.0).abs() < 1e-15);
    }

    #[test]
    fn tan_negative() {
        assert!((n(&eval("=TAN(-PI()/4)")) + 1.0).abs() < 1e-15);
    }

    #[test]
    fn tan_pi_approx_zero() {
        assert!(n(&eval("=TAN(PI())")).abs() < 1e-15);
    }

    #[test]
    fn tan_via_radians() {
        assert!((n(&eval("=TAN(RADIANS(60))")) - 3.0f64.sqrt()).abs() < 1e-14);
    }

    #[test]
    fn huge_near_half_pi_finite() {
        // f64 cos never hits exactly 0 at PI()/2; result is finite.
        let v = n(&eval("=TAN(PI()/2)"));
        assert!(v.is_finite() && v.abs() > 1e10);
    }

    #[test]
    fn text_coercion() {
        assert_eq!(n(&eval("=TAN(\"0\")")), 0.0);
    }

    #[test]
    fn bad_text() {
        assert_eq!(e(&eval("=TAN(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=TAN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=TAN()")), CalcError::Value);
        assert_eq!(e(&eval("=TAN(1,2)")), CalcError::Value);
    }
}
