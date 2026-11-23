//! `HEX2OCT(number, [places])` — hexadecimal string to octal text.
//! Representable range `[-536870912, 536870911]` (+/-2^29); outside ->
//! `#NUM!`. Spec: `docs/functions/HEX2OCT.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::number::format_radix;
use crate::engineering::dec2bin::eval_places;
use crate::engineering::hex2dec::eval_hex;

/// Octal two's-complement domain of the `?2OCT` family: +/-2^29.
const OCT_MIN: i64 = -536_870_912;
const OCT_MAX: i64 = 536_870_911;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let n = match eval_hex(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if !(OCT_MIN..=OCT_MAX).contains(&n) {
        return Ok(Value::Error(CalcError::Num));
    }
    let places = match eval_places(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    match format_radix(n, 8, places) {
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
        assert_eq!(t(&eval(r#"=HEX2OCT("F",3)"#)), "017");
        assert_eq!(t(&eval(r#"=HEX2OCT("3B4E")"#)), "35516");
        assert_eq!(t(&eval(r#"=HEX2OCT("FFFFFFFF00")"#)), "7777777400");
        assert_eq!(e(&eval(r#"=HEX2OCT("1ZZ")"#)), CalcError::Num);
    }

    #[test]
    fn range_bounds() {
        // -2^29 (hex FFE0000000) is representable; +2^29 / -2^29-1 are not.
        assert_eq!(t(&eval(r#"=HEX2OCT("FFE0000000")"#)), "4000000000");
        assert_eq!(t(&eval(r#"=HEX2OCT("1FFFFFFF")"#)), "3777777777");
        assert_eq!(e(&eval(r#"=HEX2OCT("20000000")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=HEX2OCT("FFDFFFFFFF")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=HEX2OCT("7FFFFFFFFF")"#)), CalcError::Num);
    }

    #[test]
    fn negative_ignores_places() {
        assert_eq!(t(&eval(r#"=HEX2OCT("FFFFFFFF00",3)"#)), "7777777400");
    }

    #[test]
    fn lowercase_accepted() {
        assert_eq!(t(&eval(r#"=HEX2OCT("3b4e")"#)), "35516");
    }

    #[test]
    fn places_range_num() {
        assert_eq!(e(&eval(r#"=HEX2OCT("1",-1)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=HEX2OCT("1",11)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=HEX2OCT("3B4E",4)"#)), CalcError::Num);
    }

    #[test]
    fn places_truncates() {
        assert_eq!(t(&eval(r#"=HEX2OCT("1",4.9)"#)), "0001");
    }

    #[test]
    fn numeric_arg() {
        assert_eq!(t(&eval("=HEX2OCT(9)")), "11");
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(t(&eval("=HEX2OCT(A1)")), "0");
    }

    #[test]
    fn places_bad_text() {
        assert_eq!(e(&eval(r#"=HEX2OCT("1","x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=HEX2OCT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=HEX2OCT()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=HEX2OCT("1",2,3)"#)), CalcError::Value);
    }
}
