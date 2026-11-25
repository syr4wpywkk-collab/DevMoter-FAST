//! `BIN2DEC(number)` — signed two's-complement binary string to decimal.
//! Spec: `docs/functions/BIN2DEC.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::number::base_digits;

/// Decode a validated binary digit string (<= 10 chars) the Excel way:
/// a 10-character input starting with `1` is two's-complement negative,
/// shorter inputs are positive.
pub(crate) fn decode_binary(digits: &str) -> i64 {
    let v = i64::from_str_radix(digits, 2).unwrap();
    if digits.len() == 10 && digits.starts_with('1') {
        v - 1024
    } else {
        v
    }
}

/// Evaluate the binary `number` argument shared by `BIN2DEC`/`BIN2HEX`/
/// `BIN2OCT`: returns the signed decimal value, `Err` is the
/// `CalcError` to emit.
pub(crate) fn eval_binary(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<i64, calc_core::error::CalcError>, EvalError> {
    let v = ctx.eval(arg)?;
    Ok(base_digits(&v, 2, 10).map(|d| decode_binary(&d)))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match eval_binary(ctx, &args[0])? {
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
        assert_eq!(n(&eval(r#"=BIN2DEC("1100100")"#)), 100.0);
        assert_eq!(n(&eval(r#"=BIN2DEC("1111111111")"#)), -1.0);
        assert_eq!(n(&eval(r#"=BIN2DEC("1000000000")"#)), -512.0);
        assert_eq!(n(&eval(r#"=BIN2DEC("0111111111")"#)), 511.0);
    }

    #[test]
    fn positive_small() {
        assert_eq!(n(&eval(r#"=BIN2DEC("1010")"#)), 10.0);
        assert_eq!(n(&eval(r#"=BIN2DEC("1")"#)), 1.0);
        assert_eq!(n(&eval(r#"=BIN2DEC("0")"#)), 0.0);
    }

    #[test]
    fn too_many_chars_num() {
        assert_eq!(e(&eval(r#"=BIN2DEC("11111111111")"#)), CalcError::Num);
    }

    #[test]
    fn invalid_digit_num() {
        // #NUM! (not #VALUE!) is the documented error for bad input.
        assert_eq!(e(&eval(r#"=BIN2DEC("2")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=BIN2DEC("10a1")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=BIN2DEC("-101")"#)), CalcError::Num);
    }

    #[test]
    fn whitespace_num() {
        // Excel does not trim the digit string (SPEC-OPEN: confirm).
        assert_eq!(e(&eval(r#"=BIN2DEC(" 101")"#)), CalcError::Num);
    }

    #[test]
    fn numeric_arg() {
        // A number whose decimal digits are all 0/1 is accepted.
        assert_eq!(n(&eval("=BIN2DEC(101)")), 5.0);
        assert_eq!(e(&eval("=BIN2DEC(102)")), CalcError::Num);
        assert_eq!(e(&eval("=BIN2DEC(-101)")), CalcError::Num);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=BIN2DEC(A1)")), 0.0);
    }

    #[test]
    fn boolean_num() {
        // SPEC-OPEN: Excel treats TRUE/FALSE as non-binary input.
        assert_eq!(e(&eval("=BIN2DEC(TRUE)")), CalcError::Num);
    }

    #[test]
    fn cell_ref_text() {
        assert_eq!(
            n(&eval_with(
                &[("A1", Value::Text("1100100".into()))],
                "=BIN2DEC(A1)"
            )),
            100.0
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BIN2DEC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BIN2DEC()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=BIN2DEC("1","2")"#)), CalcError::Value);
    }
}
