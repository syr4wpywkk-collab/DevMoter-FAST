//! `ATAN(number)` — arctangent of `number` in radians, `(-PI/2, PI/2)`.
//! Spec: `docs/functions/ATAN.md`.
//!
//! No domain restriction.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    Ok(Value::Number(x.atan()))
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
        assert!((n(&eval("=ATAN(1)")) - std::f64::consts::FRAC_PI_4).abs() < 1e-12);
        assert!((n(&eval("=ATAN(-1)")) + std::f64::consts::FRAC_PI_4).abs() < 1e-12);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=ATAN(0)")), 0.0);
    }

    #[test]
    fn pi_over_4() {
        assert!((n(&eval("=ATAN(1)")) - std::f64::consts::FRAC_PI_4).abs() < 1e-15);
    }

    #[test]
    fn odd_function() {
        assert_eq!(n(&eval("=ATAN(2)")), -n(&eval("=ATAN(-2)")));
    }

    #[test]
    fn large_magnitude_approaches_pi_over_2() {
        assert!((n(&eval("=ATAN(1E15)")) - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=ATAN("1")"#)), n(&eval("=ATAN(1)")));
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ATAN("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=ATAN(TRUE)")), n(&eval("=ATAN(1)")));
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=ATAN(A1)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ATAN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ATAN(1,2)")), CalcError::Value);
        assert_eq!(e(&eval("=ATAN()")), CalcError::Value);
    }
}
