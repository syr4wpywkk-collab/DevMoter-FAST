//! `ACOT(number)` — principal arccotangent of `number` in radians,
//! range `(0, PI)`. Spec: `docs/functions/ACOT.md`.
//!
//! `ACOT(x) = PI/2 - ATAN(x)`; no domain restriction.

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
    Ok(Value::Number(std::f64::consts::FRAC_PI_2 - x.atan()))
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
        assert!((n(&eval("=ACOT(2)")) - 0.4636476090008061).abs() < 1e-12);
        assert!((n(&eval("=ACOT(0)")) - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
        assert!((n(&eval("=ACOT(-2)")) - 2.677945044588987).abs() < 1e-12);
    }

    #[test]
    fn range_is_open_interval() {
        let v = n(&eval("=ACOT(1e15)"));
        assert!(v > 0.0 && v < std::f64::consts::PI);
        let v = n(&eval("=ACOT(-1e15)"));
        assert!(v > 0.0 && v < std::f64::consts::PI);
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=ACOT("2")"#)) - 0.4636476090008061).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ACOT("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert!((n(&eval("=ACOT(TRUE)")) - std::f64::consts::FRAC_PI_4).abs() < 1e-12);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert!((n(&eval("=ACOT(A1)")) - std::f64::consts::FRAC_PI_2).abs() < 1e-12);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ACOT(1/0)")), CalcError::DivZero);
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=ACOT(A1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ACOT()")), CalcError::Value);
        assert_eq!(e(&eval("=ACOT(1,2)")), CalcError::Value);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 2.0.into())], "=ACOT(A1)");
        assert!((n(&v) - 0.4636476090008061).abs() < 1e-12);
    }
}
