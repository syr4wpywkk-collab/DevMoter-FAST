//! `DEGREES(angle)` — converts radians to degrees.
//! Spec: `docs/functions/DEGREES.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match ctx.eval(&args[0])?.to_number() {
        Ok(x) => Ok(Value::Number(x.to_degrees())),
        Err(e) => Ok(Value::Error(e)),
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
    fn spec_examples() {
        // PI() is not implemented; use the literal (spec examples
        // `PI()`/`PI()/4` evaluate to the same values).
        assert!((n(&eval("=DEGREES(3.141592653589793)")) - 180.0).abs() < 1e-12);
        assert!((n(&eval("=DEGREES(0.7853981633974483)")) - 45.0).abs() < 1e-12);
        assert_eq!(n(&eval("=DEGREES(0)")), 0.0);
    }

    #[test]
    fn unit_radian() {
        assert!((n(&eval("=DEGREES(1)")) - 57.29577951308232).abs() < 1e-13);
    }

    #[test]
    fn negative() {
        assert!((n(&eval("=DEGREES(-3.141592653589793)")) - -180.0).abs() < 1e-12);
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=DEGREES("3.14159265358979")"#)) - 180.0).abs() < 1e-10);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=DEGREES("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert!((n(&eval("=DEGREES(TRUE)")) - 57.29577951308232).abs() < 1e-13);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=DEGREES(A1)")), 0.0);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 1.0.into())], "=DEGREES(A1)");
        assert!((n(&v) - 57.29577951308232).abs() < 1e-13);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DEGREES(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DEGREES(1,2)")), CalcError::Value);
    }
}
