//! `ABS(number)` — absolute value. Exactly one argument.
//! Spec: `docs/functions/ABS.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval(&args[0])?;
    if let Some(e) = v.error() {
        return Ok(Value::Error(e));
    }
    match v.to_number() {
        Ok(n) => Ok(Value::Number(n.abs())),
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
    fn negative() {
        assert_eq!(n(&eval("=ABS(-3)")), 3.0);
    }

    #[test]
    fn positive() {
        assert_eq!(n(&eval("=ABS(3)")), 3.0);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=ABS(0)")), 0.0);
    }

    #[test]
    fn fractional() {
        assert_eq!(n(&eval("=ABS(-2.5)")), 2.5);
        assert!((n(&eval("=ABS(-0.001)")) - 0.001).abs() < 1e-15);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=ABS("-2.5")"#)), 2.5);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ABS("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=ABS(TRUE)")), 1.0);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", (-7.0).into())], "=ABS(A1)");
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        // P1-ABS-009 (blank -> 0, specOpen confirmation recorded).
        let v = eval_with(&[], "=ABS(A1)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ABS(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ABS(1,2)")), CalcError::Value);
    }
}
