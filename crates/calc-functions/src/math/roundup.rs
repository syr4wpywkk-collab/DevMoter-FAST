//! `ROUNDUP(number, num_digits)` — rounds away from zero to `num_digits`
//! decimal places. Spec: `docs/functions/ROUNDUP.md`.
//!
//! Implemented via [`common::number::round_to_place`] on the same
//! 15-significant-digit decimal basis as `ROUND`; the magnitude
//! increases only when a nonzero digit is discarded.

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
    let v = number::round_to_place(x, d, true);
    if !v.is_finite() {
        // Non-finite input or a result that overflows f64 (SPEC-OPEN:
        // huge negative num_digits policy).
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
        assert_eq!(n(&eval("=ROUNDUP(3.2,0)")), 4.0);
        assert_eq!(n(&eval("=ROUNDUP(76.9,0)")), 77.0);
    }

    #[allow(clippy::approx_constant)] // the point is the literal input, not pi
    #[test]
    fn positive_places() {
        assert_eq!(n(&eval("=ROUNDUP(3.14159,3)")), 3.142);
    }

    #[test]
    fn negative_number_away_from_zero() {
        assert_eq!(n(&eval("=ROUNDUP(-3.14159,1)")), -3.2);
    }

    #[test]
    fn negative_digits() {
        assert_eq!(n(&eval("=ROUNDUP(31415.92654,-2)")), 31500.0);
    }

    #[test]
    fn exact_value_unchanged() {
        // No discarded nonzero digits -> no magnitude increase.
        assert_eq!(n(&eval("=ROUNDUP(2.5,0)")), 3.0);
        assert_eq!(n(&eval("=ROUNDUP(2.0,0)")), 2.0);
        assert_eq!(n(&eval("=ROUNDUP(2.67,2)")), 2.67);
    }

    #[test]
    fn boundary_decimal() {
        // 15-digit decimal view: 2.675 -> 2.68, matching Excel.
        assert_eq!(n(&eval("=ROUNDUP(2.675,2)")), 2.68);
    }

    #[test]
    fn tiny_value_up_to_one() {
        assert_eq!(n(&eval("=ROUNDUP(0.001,0)")), 1.0);
    }

    #[test]
    fn negative_tiny() {
        assert_eq!(n(&eval("=ROUNDUP(-0.001,0)")), -1.0);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=ROUNDUP(0,2)")), 0.0);
    }

    #[allow(clippy::approx_constant)]
    #[test]
    fn fractional_digits_truncated() {
        assert_eq!(n(&eval("=ROUNDUP(3.14159,3.9)")), 3.142);
    }

    #[test]
    fn text_coercion() {
        assert_eq!(n(&eval("=ROUNDUP(\"3.2\",\"0\")")), 4.0);
    }

    #[test]
    fn bad_text() {
        assert_eq!(e(&eval("=ROUNDUP(\"x\",0)")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ROUNDUP(1/0,0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ROUNDUP(1)")), CalcError::Value);
        assert_eq!(e(&eval("=ROUNDUP(1,2,3)")), CalcError::Value);
    }
}
