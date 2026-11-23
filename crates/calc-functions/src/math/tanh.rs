//! `TANH(number)` — hyperbolic tangent. Spec: `docs/functions/TANH.md`.
//!
//! Range (-1, 1); saturates to ±1 for large |x| — no `#NUM!` domain.

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
        Ok(x) => Ok(Value::Number(x.tanh())),
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
    fn tanh_zero() {
        assert_eq!(n(&eval("=TANH(0)")), 0.0);
    }

    #[test]
    fn tanh_neg_two() {
        assert_eq!(n(&eval("=TANH(-2)")), -0.9640275800758169);
    }

    #[test]
    fn tanh_half() {
        assert_eq!(n(&eval("=TANH(0.5)")), 0.46211715726000974);
    }

    #[test]
    fn tanh_odd() {
        assert_eq!(n(&eval("=TANH(-1.5)")), -n(&eval("=TANH(1.5)")));
    }

    #[test]
    fn tanh_saturates_pos() {
        assert_eq!(n(&eval("=TANH(1000)")), 1.0);
    }

    #[test]
    fn tanh_saturates_neg() {
        assert_eq!(n(&eval("=TANH(-1000)")), -1.0);
    }

    #[test]
    fn tanh_bounded() {
        let v = n(&eval("=TANH(3)"));
        assert!(v.abs() < 1.0);
    }

    #[test]
    fn tanh_text_coercion() {
        assert_eq!(n(&eval("=TANH(\"0\")")), 0.0);
    }

    #[test]
    fn tanh_bad_text() {
        assert_eq!(e(&eval("=TANH(\"x\")")), CalcError::Value);
    }

    #[test]
    fn tanh_error_propagates() {
        assert_eq!(e(&eval("=TANH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn tanh_arity() {
        assert_eq!(e(&eval("=TANH()")), CalcError::Value);
        assert_eq!(e(&eval("=TANH(1,2)")), CalcError::Value);
    }
}
