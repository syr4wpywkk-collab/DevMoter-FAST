//! `COS(number)` — cosine of `number` (radians).
//! Spec: `docs/functions/COS.md`.

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
    Ok(Value::Number(x.cos()))
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
    fn zero() {
        assert_eq!(n(&eval("=COS(0)")), 1.0);
    }

    #[test]
    fn pi_is_minus_one() {
        assert!((n(&eval("=COS(3.141592653589793)")) + 1.0).abs() < 1e-15);
    }

    #[test]
    fn sixty_degrees() {
        assert!((n(&eval("=COS(60*3.141592653589793/180)")) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn spec_approx() {
        assert!((n(&eval("=COS(1.047)")) - 0.50017).abs() < 1e-4);
    }

    #[test]
    fn even_function() {
        assert_eq!(n(&eval("=COS(0.7)")), n(&eval("=COS(-0.7)")));
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=COS("0")"#)), 1.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=COS("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=COS(FALSE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=COS(A1)")), 1.0);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 0.5.into())], "=COS(A1)");
        assert!((n(&v) - 0.5f64.cos()).abs() < 1e-15);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=COS(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COS(1,2)")), CalcError::Value);
    }
}
