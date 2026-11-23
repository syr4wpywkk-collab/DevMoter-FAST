//! `SIGN(number)` — returns 1, 0, or -1 by the sign of `number`.
//! Spec: `docs/functions/SIGN.md`.
//!
//! `-0.0` counts as 0 (comparison against `0.0`, never signbit).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match coercion::eval_number(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(x) => Ok(Value::Number(if x > 0.0 {
            1.0
        } else if x < 0.0 {
            -1.0
        } else {
            0.0
        })),
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
    fn positive() {
        assert_eq!(n(&eval("=SIGN(10)")), 1.0);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=SIGN(4-4)")), 0.0);
    }

    #[test]
    fn negative_small() {
        assert_eq!(n(&eval("=SIGN(-0.00001)")), -1.0);
    }

    #[test]
    fn negative_zero() {
        // -0.0 must return 0, not -0 or -1.
        assert_eq!(n(&eval("=SIGN(-0)")), 0.0);
    }

    #[test]
    fn negative_large() {
        assert_eq!(n(&eval("=SIGN(-1e300)")), -1.0);
    }

    #[test]
    fn bool_true() {
        assert_eq!(n(&eval("=SIGN(TRUE)")), 1.0);
    }

    #[test]
    fn bool_false() {
        assert_eq!(n(&eval("=SIGN(FALSE)")), 0.0);
    }

    #[test]
    fn text_number() {
        assert_eq!(n(&eval("=SIGN(\"3\")")), 1.0);
    }

    #[test]
    fn text_negative() {
        assert_eq!(n(&eval("=SIGN(\"-7\")")), -1.0);
    }

    #[test]
    fn bad_text() {
        assert_eq!(e(&eval("=SIGN(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=SIGN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SIGN()")), CalcError::Value);
        assert_eq!(e(&eval("=SIGN(1,2)")), CalcError::Value);
    }
}
