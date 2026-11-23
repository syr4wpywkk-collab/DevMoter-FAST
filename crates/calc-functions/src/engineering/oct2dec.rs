//! `OCT2DEC(number)` — signed two's-complement octal string to decimal.
//! Spec: `docs/functions/OCT2DEC.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::number::base_digits;

/// Decode a validated octal digit string (<= 10 chars): a 10-character
/// input whose top digit is `4`–`7` has the 30-bit sign bit set and is
/// two's-complement negative (`"7777777777"` = −1); shorter inputs are
/// positive. Mirrors `BIN2DEC`'s decode (`docs/functions/BIN2DEC.md`).
pub(crate) fn decode_octal(digits: &str) -> i64 {
    let v = i64::from_str_radix(digits, 8).unwrap();
    if digits.len() == 10 && digits.as_bytes()[0] >= b'4' {
        v - (1 << 30)
    } else {
        v
    }
}

/// Evaluate the octal `number` argument shared by `OCT2DEC`/`OCT2BIN`/
/// `OCT2HEX`: returns the signed decimal value in `−2^29..2^29`,
/// `Err` is the `CalcError` to emit. A `-` prefix is not a valid octal
/// digit and yields `#NUM!` (SPEC-OPEN in `OCT2BIN.md`: whether Excel
/// accepts a leading minus — the `BIN2*`/`DEC2*` family does not).
pub(crate) fn eval_octal(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<i64, calc_core::error::CalcError>, EvalError> {
    let v = ctx.eval(arg)?;
    Ok(base_digits(&v, 8, 10).map(|d| decode_octal(&d)))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match eval_octal(ctx, &args[0])? {
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
        assert_eq!(n(&eval(r#"=OCT2DEC("54")"#)), 44.0);
        assert_eq!(n(&eval(r#"=OCT2DEC("7777777777")"#)), -1.0);
        assert_eq!(n(&eval(r#"=OCT2DEC("777")"#)), 511.0);
        // 30-bit two's complement -512 is octal "7777777000" (the spec
        // doc's "7777000000" is a typo — that input decodes to -262144).
        assert_eq!(n(&eval(r#"=OCT2DEC("7777777000")"#)), -512.0);
        assert_eq!(n(&eval(r#"=OCT2DEC("7777000000")"#)), -262144.0);
        assert_eq!(e(&eval(r#"=OCT2DEC("18")"#)), CalcError::Num);
    }

    #[test]
    fn positive_small() {
        assert_eq!(n(&eval(r#"=OCT2DEC("7")"#)), 7.0);
        assert_eq!(n(&eval(r#"=OCT2DEC("10")"#)), 8.0);
        assert_eq!(n(&eval(r#"=OCT2DEC("0")"#)), 0.0);
    }

    #[test]
    fn sign_bit_boundary() {
        // SPEC-OPEN in spec: 10-digit input with sign bit clear is a
        // large positive (30-bit semantics), not an error.
        assert_eq!(n(&eval(r#"=OCT2DEC("3777777777")"#)), 536870911.0);
        assert_eq!(n(&eval(r#"=OCT2DEC("4000000000")"#)), -536870912.0);
    }

    #[test]
    fn too_many_chars_num() {
        assert_eq!(e(&eval(r#"=OCT2DEC("77777777777")"#)), CalcError::Num);
    }

    #[test]
    fn invalid_digit_num() {
        // #NUM! (not #VALUE!) is the documented family error.
        assert_eq!(e(&eval(r#"=OCT2DEC("8")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=OCT2DEC("7a7")"#)), CalcError::Num);
    }

    #[test]
    fn minus_prefix_num() {
        // SPEC-OPEN: spec lists a `-` prefix as legal, but the `BIN2*`
        // sibling functions reject signs; treated as invalid input.
        assert_eq!(e(&eval(r#"=OCT2DEC("-54")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_arg() {
        // A number whose decimal digits are all 0-7 is read as octal.
        assert_eq!(n(&eval("=OCT2DEC(17)")), 15.0);
        assert_eq!(e(&eval("=OCT2DEC(18)")), CalcError::Num);
        assert_eq!(e(&eval("=OCT2DEC(-17)")), CalcError::Num);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=OCT2DEC(A1)")), 0.0);
    }

    #[test]
    fn boolean_num() {
        // SPEC-OPEN per spec ("confirm; consistent with family").
        assert_eq!(e(&eval("=OCT2DEC(TRUE)")), CalcError::Num);
    }

    #[test]
    fn cell_ref_text() {
        assert_eq!(
            n(&eval_with(
                &[("A1", Value::Text("54".into()))],
                "=OCT2DEC(A1)"
            )),
            44.0
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=OCT2DEC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=OCT2DEC()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=OCT2DEC("1","2")"#)), CalcError::Value);
    }
}
