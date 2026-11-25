//! `BITAND(number1, number2)` — bitwise AND of two non-negative
//! integers `< 2^48`. Spec: `docs/functions/BITAND.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::number::{bit_operand, shift_amount};

/// Evaluate one `BIT*` operand: coerces via [`Value::to_number`],
/// then [`bit_operand`] domain-checks to `[0, 2^48)` after truncation.
/// `Err` is the `CalcError` to emit.
fn operand(ctx: &mut EvalContext<'_>, arg: &Expr) -> Result<Result<u64, CalcError>, EvalError> {
    let v = match ctx.eval(arg)?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Err(e)),
    };
    Ok(bit_operand(v).ok_or(CalcError::Num))
}

/// Shared two-operand body for `BITAND`/`BITOR`/`BITXOR`.
pub(crate) fn eval_two(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    op: fn(u64, u64) -> u64,
) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let a = match operand(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let b = match operand(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    Ok(Value::Number(op(a, b) as f64))
}

/// Shared `(number, shift_amount)` evaluation for
/// `BITLSHIFT`/`BITRSHIFT`. Returns the operand and the signed,
/// truncated shift count.
pub(crate) fn eval_shift_args(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Result<Result<(u64, i64), CalcError>, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Err(e));
    }
    let n = match operand(ctx, &args[0])? {
        Err(e) => return Ok(Err(e)),
        Ok(v) => v,
    };
    let s = match ctx.eval(&args[1])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Err(e)),
    };
    Ok(Ok((n, shift_amount(s))))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    eval_two(ctx, args, |a, b| a & b)
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
        assert_eq!(n(&eval("=BITAND(1,5)")), 1.0);
        assert_eq!(n(&eval("=BITAND(13,25)")), 9.0);
        assert_eq!(n(&eval("=BITAND(255,240)")), 240.0);
        assert_eq!(e(&eval("=BITAND(-1,1)")), CalcError::Num);
        assert_eq!(e(&eval("=BITAND(281474976710656,1)")), CalcError::Num);
    }

    #[test]
    fn max_operand() {
        // 2^48 - 1 & 1 = 1.
        assert_eq!(n(&eval("=BITAND(281474976710655,1)")), 1.0);
    }

    #[test]
    fn fractional_truncates() {
        // SPEC-OPEN: family is documented to truncate non-integers.
        assert_eq!(n(&eval("=BITAND(13.9,25.9)")), 9.0);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=BITAND(0,0)")), 0.0);
        assert_eq!(n(&eval("=BITAND(0,7)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=BITAND("13","25")"#)), 9.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=BITAND("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=BITAND(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=BITAND(A1,5)")), 0.0);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=BITAND(TRUE,1)")), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BITAND(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval("=BITAND(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BITAND(1)")), CalcError::Value);
        assert_eq!(e(&eval("=BITAND(1,2,3)")), CalcError::Value);
    }
}
