//! `CSC(number)` — cosecant of `number` (radians) = `1/SIN(number)`.
//! Spec: `docs/functions/CSC.md`.
//!
//! `number = 0` -> `#DIV/0!`; `ABS(number) >= 2^27` -> `#NUM!`
//! (documented Excel bound).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

const LIMIT: f64 = 134_217_728.0; // 2^27

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if x == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    if x.abs() >= LIMIT {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(1.0 / x.sin()))
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
    fn thirty_degrees() {
        assert!((n(&eval("=CSC(0.5235987755982989)")) - 2.0).abs() < 1e-12);
    }

    #[test]
    fn spec_examples() {
        assert!((n(&eval("=CSC(1)")) - 1.1883951057781212).abs() < 1e-12);
        assert!((n(&eval("=CSC(15)")) - 1.5377805615408537).abs() < 1e-12);
    }

    #[test]
    fn zero_divzero() {
        assert_eq!(e(&eval("=CSC(0)")), CalcError::DivZero);
    }

    #[test]
    fn limit_num_error() {
        assert_eq!(e(&eval("=CSC(2^27)")), CalcError::Num);
        assert_eq!(e(&eval("=CSC(-2^27)")), CalcError::Num);
    }

    #[test]
    fn just_under_limit_ok() {
        assert!(matches!(eval("=CSC(2^27-1)"), Value::Number(_)));
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=CSC("1")"#)) - 1.1883951057781212).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=CSC("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=CSC(TRUE)")), 1.0 / 1.0f64.sin());
    }

    #[test]
    fn blank_ref_is_zero_divzero() {
        assert_eq!(e(&eval("=CSC(A1)")), CalcError::DivZero);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=CSC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CSC(1,2)")), CalcError::Value);
    }
}
