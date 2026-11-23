//! `COT(number)` — cotangent of `number` (radians) = `1/TAN(number)`.
//! Spec: `docs/functions/COT.md`.
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
    Ok(Value::Number(1.0 / x.tan()))
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
    fn forty_five_degrees() {
        assert!((n(&eval("=COT(0.7853981633974483)")) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn spec_example() {
        assert!((n(&eval("=COT(0.5)")) - 1.830487721712452).abs() < 1e-12);
    }

    #[test]
    fn zero_divzero() {
        assert_eq!(e(&eval("=COT(0)")), CalcError::DivZero);
    }

    #[test]
    fn limit_num_error() {
        assert_eq!(e(&eval("=COT(2^27)")), CalcError::Num);
        assert_eq!(e(&eval("=COT(-2^27)")), CalcError::Num);
    }

    #[test]
    fn just_under_limit_ok() {
        assert!(matches!(eval("=COT(2^27-1)"), Value::Number(_)));
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=COT("0.5")"#)) - 1.830487721712452).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=COT("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=COT(TRUE)")), 1.0 / 1.0f64.tan());
    }

    #[test]
    fn blank_ref_is_zero_divzero() {
        assert_eq!(e(&eval("=COT(A1)")), CalcError::DivZero);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=COT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COT(1,2)")), CalcError::Value);
    }
}
