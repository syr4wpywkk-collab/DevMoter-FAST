//! `HEX2BIN(number, [places])` — hexadecimal string to binary text.
//! Representable range `[-512, 511]`; outside -> `#NUM!`.
//! Spec: `docs/functions/HEX2BIN.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::number::format_radix;
use crate::engineering::dec2bin::eval_places;
use crate::engineering::hex2dec::eval_hex;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let n = match eval_hex(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if !(-512..=511).contains(&n) {
        return Ok(Value::Error(CalcError::Num));
    }
    let places = match eval_places(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    match format_radix(n, 2, places) {
        Ok(s) => Ok(Value::Text(s)),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn t(v: &Value) -> &str {
        match v {
            Value::Text(s) => s,
            o => panic!("expected text, got {o:?}"),
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
        assert_eq!(t(&eval(r#"=HEX2BIN("F",8)"#)), "00001111");
        assert_eq!(t(&eval(r#"=HEX2BIN("B7")"#)), "10110111");
        assert_eq!(t(&eval(r#"=HEX2BIN("FFFFFFFFFF")"#)), "1111111111");
        assert_eq!(e(&eval(r#"=HEX2BIN("3DA408B9")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=HEX2BIN("1ZZ")"#)), CalcError::Num);
    }

    #[test]
    fn range_bounds() {
        assert_eq!(t(&eval(r#"=HEX2BIN("1FF")"#)), "111111111");
        assert_eq!(t(&eval(r#"=HEX2BIN("FFFFFFFFE0")"#)), "1111100000");
        assert_eq!(e(&eval(r#"=HEX2BIN("0000000200")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=HEX2BIN("FFFFFFFDFF")"#)), CalcError::Num);
    }

    #[test]
    fn negative_ignores_places() {
        assert_eq!(t(&eval(r#"=HEX2BIN("FFFFFFFFFF",3)"#)), "1111111111");
    }

    #[test]
    fn lowercase_accepted() {
        assert_eq!(t(&eval(r#"=HEX2BIN("b7")"#)), "10110111");
    }

    #[test]
    fn places_range_num() {
        assert_eq!(e(&eval(r#"=HEX2BIN("1",-1)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=HEX2BIN("1",11)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=HEX2BIN("1FF",2)"#)), CalcError::Num);
    }

    #[test]
    fn places_truncates() {
        assert_eq!(t(&eval(r#"=HEX2BIN("1",4.9)"#)), "0001");
    }

    #[test]
    fn numeric_arg() {
        // Decimal digits reread as hex: HEX2BIN(9) -> hex 9.
        assert_eq!(t(&eval("=HEX2BIN(9)")), "1001");
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(t(&eval("=HEX2BIN(A1)")), "0");
    }

    #[test]
    fn places_bad_text() {
        assert_eq!(e(&eval(r#"=HEX2BIN("1","x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=HEX2BIN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=HEX2BIN()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=HEX2BIN("1",2,3)"#)), CalcError::Value);
    }
}
