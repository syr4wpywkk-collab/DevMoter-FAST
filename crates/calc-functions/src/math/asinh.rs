//! `ASINH(number)` — inverse hyperbolic sine of `number`.
//! Spec: `docs/functions/ASINH.md`.
//!
//! `ASINH(x) = LN(x + SQRT(x^2 + 1))`; odd function, no domain
//! restriction.

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
    Ok(Value::Number(x.asinh()))
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
        assert!((n(&eval("=ASINH(-2.5)")) - -1.6472311463710958).abs() < 1e-12);
        assert!((n(&eval("=ASINH(10)")) - 2.99822295029797).abs() < 1e-12);
        assert_eq!(n(&eval("=ASINH(0)")), 0.0);
    }

    #[test]
    fn odd_function() {
        let a = n(&eval("=ASINH(3)"));
        let b = n(&eval("=ASINH(-3)"));
        assert!((a + b).abs() < 1e-15);
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=ASINH("-2.5")"#)) - -1.6472311463710958).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ASINH("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert!((n(&eval("=ASINH(TRUE)")) - (1.0f64 + 2.0f64.sqrt()).ln()).abs() < 1e-12);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=ASINH(A1)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ASINH(1/0)")), CalcError::DivZero);
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=ASINH(A1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ASINH()")), CalcError::Value);
        assert_eq!(e(&eval("=ASINH(1,2)")), CalcError::Value);
    }

    #[test]
    fn closed_form_matches() {
        // ASINH(x) = LN(x + SQRT(x^2 + 1)).
        let x = 3.0f64;
        let v = n(&eval("=ASINH(3)"));
        assert!((v - (x + (x * x + 1.0).sqrt()).ln()).abs() < 1e-15);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", (-2.5).into())], "=ASINH(A1)");
        assert!((n(&v) + 1.6472311463710958).abs() < 1e-12);
    }
}
