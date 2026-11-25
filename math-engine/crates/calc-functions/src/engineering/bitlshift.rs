//! `BITLSHIFT(number, shift_amount)` — logical left shift of a
//! non-negative integer `< 2^48`; negative `shift_amount` shifts right.
//! Spec: `docs/functions/BITLSHIFT.md`.

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
        // Result must stay < 2^48 (SPEC-OPEN: result == 2^48 boundary).
        if n == 0 {
            // 0 << anything stays 0 (SPEC-OPEN for s >= 48).
            0
        } else if s >= 64 {
            return Ok(Value::Error(CalcError::Num));
        } else {
            match n.checked_shl(s as u32) {
                Some(r) if (r as f64) < BIT_OPERAND_MAX => r,
                _ => return Ok(Value::Error(CalcError::Num)),
            }
        }
    } else {
        let mag = (-s).min(64) as u32;
        n.checked_shr(mag).unwrap_or(0)
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
        assert_eq!(n(&eval("=BITLSHIFT(4,2)")), 16.0);
        assert_eq!(n(&eval("=BITLSHIFT(4,-1)")), 2.0);
        assert_eq!(n(&eval("=BITLSHIFT(1,47)")), 140737488355328.0);
        assert_eq!(e(&eval("=BITLSHIFT(3,47)")), CalcError::Num);
    }

    #[test]
    fn zero_shift() {
        assert_eq!(n(&eval("=BITLSHIFT(7,0)")), 7.0);
    }

    #[test]
    fn shift_zero_operand() {
        // 0 << k stays 0 for any k (SPEC-OPEN for k >= 48).
        assert_eq!(n(&eval("=BITLSHIFT(0,60)")), 0.0);
        assert_eq!(n(&eval("=BITLSHIFT(0,48)")), 0.0);
    }

    #[test]
    fn result_at_boundary() {
        // 2^47 << 1 = 2^48 - 2? No: 2^47<<1 = 2^48 -> #NUM!.
        assert_eq!(e(&eval("=BITLSHIFT(140737488355328,1)")), CalcError::Num);
        assert_eq!(n(&eval("=BITLSHIFT(70368744177664,1)")), 140737488355328.0);
    }

    #[test]
    fn negative_shift_right() {
        assert_eq!(n(&eval("=BITLSHIFT(13,-2)")), 3.0);
        // Huge negative shift -> 0.
        assert_eq!(n(&eval("=BITLSHIFT(13,-100)")), 0.0);
    }

    #[test]
    fn fractional_shift_truncates() {
        // SPEC-OPEN: fractional shift_amount truncation.
        assert_eq!(n(&eval("=BITLSHIFT(4,2.9)")), 16.0);
    }

    #[test]
    fn invalid_number_num() {
        assert_eq!(e(&eval("=BITLSHIFT(-1,1)")), CalcError::Num);
        assert_eq!(e(&eval("=BITLSHIFT(281474976710656,0)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=BITLSHIFT("4","2")"#)), 16.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=BITLSHIFT("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=BITLSHIFT(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_shift_is_zero() {
        assert_eq!(n(&eval("=BITLSHIFT(4,A1)")), 4.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BITLSHIFT(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval("=BITLSHIFT(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BITLSHIFT(1)")), CalcError::Value);
        assert_eq!(e(&eval("=BITLSHIFT(1,2,3)")), CalcError::Value);
    }
}
