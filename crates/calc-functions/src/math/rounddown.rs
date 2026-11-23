//! `ROUNDDOWN(number, num_digits)` — rounds toward zero to `num_digits`
//! decimal places. Spec: `docs/functions/ROUNDDOWN.md`.
//!
//! Implemented via [`common::number::round_to_place`], the same
//! 15-significant-digit decimal basis as `ROUND` — raw scaled `f64`
//! truncation would drift at representable half-boundaries.

use crate::common::{coercion, number};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let x = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let d = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let v = number::round_to_place(x, d, false);
    if v.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(v))
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
    fn basic_zero_digits() {
        assert_eq!(n(&eval("=ROUNDDOWN(3.2,0)")), 3.0);
        assert_eq!(n(&eval("=ROUNDDOWN(76.9,0)")), 76.0);
    }

    #[allow(clippy::approx_constant)] // the point is the literal input, not pi
    #[test]
    fn positive_places() {
        assert_eq!(n(&eval("=ROUNDDOWN(3.14159,3)")), 3.141);
    }

    #[test]
    fn negative_number_toward_zero() {
        assert_eq!(n(&eval("=ROUNDDOWN(-3.14159,1)")), -3.1);
    }

    #[test]
    fn negative_digits() {
        assert_eq!(n(&eval("=ROUNDDOWN(31415.92654,-2)")), 31400.0);
    }

    #[test]
    fn negative_digits_negative_number() {
        assert_eq!(n(&eval("=ROUNDDOWN(-31415.92654,-2)")), -31400.0);
    }

    #[test]
    fn truncates_half_not_rounds() {
        // Unlike ROUND: 2.5 -> 2, not 3.
        assert_eq!(n(&eval("=ROUNDDOWN(2.5,0)")), 2.0);
        assert_eq!(n(&eval("=ROUNDDOWN(-2.5,0)")), -2.0);
    }

    #[test]
    fn tiny_value_zero() {
        assert_eq!(n(&eval("=ROUNDDOWN(0.4,0)")), 0.0);
    }

    #[test]
    fn huge_negative_digits() {
        assert_eq!(n(&eval("=ROUNDDOWN(12345,-10)")), 0.0);
    }

    #[allow(clippy::approx_constant)]
    #[test]
    fn fractional_digits_truncated() {
        assert_eq!(n(&eval("=ROUNDDOWN(3.14159,3.9)")), 3.141);
    }

    #[test]
    fn no_change_when_exact() {
        assert_eq!(n(&eval("=ROUNDDOWN(2.67,2)")), 2.67);
    }

    #[test]
    fn text_coercion() {
        assert_eq!(n(&eval("=ROUNDDOWN(\"3.7\",\"0\")")), 3.0);
    }

    #[test]
    fn bad_text() {
        assert_eq!(e(&eval("=ROUNDDOWN(\"x\",0)")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ROUNDDOWN(1/0,0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ROUNDDOWN(1)")), CalcError::Value);
        assert_eq!(e(&eval("=ROUNDDOWN(1,2,3)")), CalcError::Value);
    }
}
