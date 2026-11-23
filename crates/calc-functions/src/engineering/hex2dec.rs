//! `HEX2DEC(number)` — signed two's-complement hexadecimal string
//! (max 10 chars) to decimal. Spec: `docs/functions/HEX2DEC.md`.
//!
//! Hosts the shared hex evaluation (`eval_hex`/`decode_hex`) used by
//! `HEX2BIN`/`HEX2OCT` — same role `bin2dec::eval_binary` plays.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::number::base_digits;

/// Decode a validated hex digit string (<= 10 chars) the Excel way:
/// a 10-character input whose top bit is set is two's-complement
/// negative (modulus 2^40); shorter inputs are positive.
pub(crate) fn decode_hex(digits: &str) -> i64 {
    let v = i64::from_str_radix(digits, 16).unwrap();
    if digits.len() == 10 && digits.as_bytes()[0].to_ascii_uppercase() >= b'8' {
        v - (1i64 << 40)
    } else {
        v
    }
}

/// Evaluate the hexadecimal `number` argument shared by
/// `HEX2DEC`/`HEX2BIN`/`HEX2OCT`: returns the signed decimal value,
/// `Err` is the `CalcError` to emit.
pub(crate) fn eval_hex(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<i64, calc_core::error::CalcError>, EvalError> {
    let v = ctx.eval(arg)?;
    Ok(base_digits(&v, 16, 10).map(|d| decode_hex(&d)))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match eval_hex(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(n) => Ok(Value::Number(n as f64)),
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
    fn spec_examples() {
        assert_eq!(n(&eval(r#"=HEX2DEC("A5")"#)), 165.0);
        assert_eq!(n(&eval(r#"=HEX2DEC("FFFFFFFF5B")"#)), -165.0);
        assert_eq!(n(&eval(r#"=HEX2DEC("3DA408B9")"#)), 1034160313.0);
        assert_eq!(n(&eval(r#"=HEX2DEC("FFFFFFFFFF")"#)), -1.0);
        assert_eq!(e(&eval(r#"=HEX2DEC("G1")"#)), CalcError::Num);
    }

    #[test]
    fn range_bounds() {
        assert_eq!(n(&eval(r#"=HEX2DEC("7FFFFFFFFF")"#)), 549755813887.0);
        assert_eq!(n(&eval(r#"=HEX2DEC("8000000000")"#)), -549755813888.0);
    }

    #[test]
    fn short_input_positive() {
        assert_eq!(n(&eval(r#"=HEX2DEC("F")"#)), 15.0);
        assert_eq!(n(&eval(r#"=HEX2DEC("0")"#)), 0.0);
    }

    #[test]
    fn lowercase_accepted() {
        assert_eq!(n(&eval(r#"=HEX2DEC("ff")"#)), 255.0);
    }

    #[test]
    fn too_many_chars_num() {
        assert_eq!(e(&eval(r#"=HEX2DEC("12345678901")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_arg_reinterpreted() {
        // SPEC-OPEN: numeric 10 read as hex "10" = 16 (HEX2DEC.md).
        assert_eq!(n(&eval("=HEX2DEC(10)")), 16.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=HEX2DEC(A1)")), 0.0);
    }

    #[test]
    fn boolean_num() {
        // Consistent with base_digits' family rule (SPEC-OPEN).
        assert_eq!(e(&eval("=HEX2DEC(TRUE)")), CalcError::Num);
    }

    #[test]
    fn cell_ref_text() {
        assert_eq!(
            n(&eval_with(
                &[("A1", Value::Text("A5".into()))],
                "=HEX2DEC(A1)"
            )),
            165.0
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=HEX2DEC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=HEX2DEC()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=HEX2DEC("1","2")"#)), CalcError::Value);
    }
}
