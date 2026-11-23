//! `SIN(number)` — sine of an angle in radians. Spec: `docs/functions/SIN.md`.
//!
//! No special-casing of pi multiples: `SIN(PI())` is the f64 `sin` of the
//! f64 nearest to pi (~1.22e-16), per the spec's recorded decision.
//! SPEC-OPEN: large-argument domain policy shared with `SEC`/`COS`.

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
        Ok(x) => Ok(Value::Number(x.sin())),
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
    fn sin_zero() {
        assert_eq!(n(&eval("=SIN(0)")), 0.0);
    }

    #[test]
    fn sin_half_pi() {
        assert_eq!(n(&eval("=SIN(PI()/2)")), 1.0);
    }

    #[test]
    fn sin_pi_approx_zero() {
        // Not exactly 0 in f64 — document the tiny residue.
        assert!(n(&eval("=SIN(PI())")).abs() < 1e-15);
    }

    #[test]
    fn sin_30_deg() {
        assert!((n(&eval("=SIN(30*PI()/180)")) - 0.5).abs() < 1e-15);
    }

    #[test]
    fn sin_negative() {
        assert!((n(&eval("=SIN(-PI()/2)")) + 1.0).abs() < 1e-15);
    }

    #[test]
    fn sin_via_radians() {
        assert!((n(&eval("=SIN(RADIANS(90))")) - 1.0).abs() < 1e-15);
    }

    #[test]
    fn text_coercion() {
        assert_eq!(n(&eval("=SIN(\"0\")")), 0.0);
    }

    #[test]
    fn bad_text() {
        assert_eq!(e(&eval("=SIN(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=SIN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SIN()")), CalcError::Value);
        assert_eq!(e(&eval("=SIN(1,2)")), CalcError::Value);
    }
}
