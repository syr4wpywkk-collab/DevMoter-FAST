//! `COTH(number)` — hyperbolic cotangent of `number` = `1/TANH(number)`.
//! Spec: `docs/functions/COTH.md`.
//!
//! `number = 0` -> `#DIV/0!`. Result is bounded in `|result| >= 1`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
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
    if x == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(1.0 / x.tanh()))
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
        assert!((n(&eval("=COTH(1)")) - 1.3130352854993315).abs() < 1e-12);
        assert!((n(&eval("=COTH(2)")) - 1.0373147207275482).abs() < 1e-12);
        assert!((n(&eval("=COTH(3)")) - 1.0049698233136892).abs() < 1e-12);
    }

    #[test]
    fn odd_function() {
        assert_eq!(n(&eval("=COTH(2)")), -n(&eval("=COTH(-2)")));
    }

    #[test]
    fn negative() {
        assert!((n(&eval("=COTH(-1)")) + 1.3130352854993315).abs() < 1e-12);
    }

    #[test]
    fn large_approaches_one() {
        assert!((n(&eval("=COTH(500)")) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn zero_divzero() {
        assert_eq!(e(&eval("=COTH(0)")), CalcError::DivZero);
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=COTH("1")"#)) - 1.3130352854993315).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=COTH("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=COTH(TRUE)")), 1.0 / 1.0f64.tanh());
    }

    #[test]
    fn blank_ref_is_zero_divzero() {
        assert_eq!(e(&eval("=COTH(A1)")), CalcError::DivZero);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=COTH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COTH(1,2)")), CalcError::Value);
    }
}
