//! `BITRSHIFT(number, shift_amount)` — logical right shift of a
//! non-negative integer `< 2^48`; negative `shift_amount` shifts left.
//! Spec: `docs/functions/BITRSHIFT.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use crate::common::number::BIT_OPERAND_MAX;
use crate::engineering::bitand::eval_shift_args;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let (n, s) = match eval_shift_args(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let result = if s >= 0 {
        // Logical right shift; >= 48 bits always yields 0.
        let mag = s.min(64) as u32;
        n.checked_shr(mag).unwrap_or(0)
    } else {
        // Left shift; overflow at/above 2^48 -> #NUM!.
        let mag = -s;
        if n == 0 {
            0
        } else if mag >= 64 {
            return Ok(Value::Error(CalcError::Num));
        } else {
            match n.checked_shl(mag as u32) {
                Some(r) if (r as f64) < BIT_OPERAND_MAX => r,
                _ => return Ok(Value::Error(CalcError::Num)),
            }
        }
    };
    Ok(Value::Number(result as f64))
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
        assert_eq!(n(&eval("=BITRSHIFT(13,2)")), 3.0);
        assert_eq!(n(&eval("=BITRSHIFT(4,-1)")), 8.0);
        assert_eq!(n(&eval("=BITRSHIFT(7,3)")), 0.0);
        assert_eq!(e(&eval("=BITRSHIFT(1,-48)")), CalcError::Num);
    }

    #[test]
    fn zero_shift() {
        assert_eq!(n(&eval("=BITRSHIFT(7,0)")), 7.0);
    }

    #[test]
    fn big_right_shift_zero() {
        assert_eq!(n(&eval("=BITRSHIFT(281474976710655,48)")), 0.0);
        assert_eq!(n(&eval("=BITRSHIFT(1,100)")), 0.0);
    }

    #[test]
    fn negative_shift_left_overflow() {
        // -47: 1 << 47 < 2^48 ok; -48 -> #NUM!.
        assert_eq!(n(&eval("=BITRSHIFT(1,-47)")), 140737488355328.0);
        assert_eq!(e(&eval("=BITRSHIFT(3,-47)")), CalcError::Num);
    }

    #[test]
    fn fractional_shift_truncates() {
        // SPEC-OPEN: fractional shift_amount truncation.
        assert_eq!(n(&eval("=BITRSHIFT(13,2.9)")), 3.0);
    }

    #[test]
    fn invalid_number_num() {
        assert_eq!(e(&eval("=BITRSHIFT(-1,1)")), CalcError::Num);
        assert_eq!(e(&eval("=BITRSHIFT(281474976710656,0)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=BITRSHIFT("13","2")"#)), 3.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=BITRSHIFT("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=BITRSHIFT(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_shift_is_zero() {
        assert_eq!(n(&eval("=BITRSHIFT(4,A1)")), 4.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BITRSHIFT(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BITRSHIFT(1)")), CalcError::Value);
        assert_eq!(e(&eval("=BITRSHIFT(1,2,3)")), CalcError::Value);
    }
}
