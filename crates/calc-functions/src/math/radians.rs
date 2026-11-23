//! `RADIANS(angle)` — converts degrees to radians (`angle * PI() / 180`).
//! Spec: `docs/functions/RADIANS.md`.

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
        Ok(deg) => Ok(Value::Number(deg * std::f64::consts::PI / 180.0)),
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
    fn degrees_180() {
        assert_eq!(n(&eval("=RADIANS(180)")), std::f64::consts::PI);
    }

    #[test]
    fn degrees_270() {
        assert!((n(&eval("=RADIANS(270)")) - 4.71238898038469).abs() < 1e-14);
    }

    #[test]
    fn degrees_neg_90() {
        assert_eq!(n(&eval("=RADIANS(-90)")), -std::f64::consts::FRAC_PI_2);
    }

    #[test]
    fn degrees_zero() {
        assert_eq!(n(&eval("=RADIANS(0)")), 0.0);
    }

    #[test]
    fn degrees_360() {
        assert_eq!(n(&eval("=RADIANS(360)")), 2.0 * std::f64::consts::PI);
    }

    #[test]
    fn fractional_degrees() {
        assert!((n(&eval("=RADIANS(45)")) - std::f64::consts::FRAC_PI_4).abs() < 1e-15);
    }

    #[test]
    fn text_coercion() {
        assert_eq!(n(&eval("=RADIANS(\"90\")")), std::f64::consts::FRAC_PI_2);
    }

    #[test]
    fn bool_coercion() {
        assert!((n(&eval("=RADIANS(TRUE)")) - 0.017453292519943295).abs() < 1e-15);
    }

    #[test]
    fn blank_is_zero() {
        let v = eval_with(&[("A1", Value::Blank)], "=RADIANS(A1)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval("=RADIANS(\"x\")")), CalcError::Value);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=RADIANS()")), CalcError::Value);
        assert_eq!(e(&eval("=RADIANS(1,2)")), CalcError::Value);
    }
}
