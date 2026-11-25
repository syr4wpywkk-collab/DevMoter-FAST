//! `BITXOR(number1, number2)` — bitwise XOR of two non-negative
//! integers `< 2^48`. Spec: `docs/functions/BITXOR.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use crate::engineering::bitand::eval_two;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    eval_two(ctx, args, |a, b| a ^ b)
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
        assert_eq!(n(&eval("=BITXOR(5,3)")), 6.0);
        assert_eq!(n(&eval("=BITXOR(255,255)")), 0.0);
        assert_eq!(n(&eval("=BITXOR(10,12)")), 6.0);
        assert_eq!(e(&eval("=BITXOR(1,-1)")), CalcError::Num);
    }

    #[test]
    fn max_operand() {
        // (2^48 - 1) ^ (2^48 - 1) = 0.
        assert_eq!(n(&eval("=BITXOR(281474976710655,281474976710655)")), 0.0);
        assert_eq!(e(&eval("=BITXOR(281474976710656,1)")), CalcError::Num);
    }

    #[test]
    fn fractional_truncates() {
        // SPEC-OPEN: truncate vs #NUM! for fractional args.
        assert_eq!(n(&eval("=BITXOR(5.9,3.9)")), 6.0);
    }

    #[test]
    fn disjoint_bits() {
        assert_eq!(n(&eval("=BITXOR(8,4)")), 12.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=BITXOR("5","3")"#)), 6.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=BITXOR("x",1)"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=BITXOR(A1,0)")), 0.0);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=BITXOR(TRUE,TRUE)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BITXOR(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BITXOR(1)")), CalcError::Value);
        assert_eq!(e(&eval("=BITXOR(1,2,3)")), CalcError::Value);
    }
}
