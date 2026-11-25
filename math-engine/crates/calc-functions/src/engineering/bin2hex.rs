//! `BIN2HEX(number, [places])` — binary string to hexadecimal text.
//! Spec: `docs/functions/BIN2HEX.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::number::format_radix;
use crate::engineering::bin2dec::eval_binary;
use crate::engineering::dec2bin::eval_places;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let n = match eval_binary(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let places = match eval_places(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    match format_radix(n, 16, places) {
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
        assert_eq!(t(&eval(r#"=BIN2HEX("11111011",4)"#)), "00FB");
        assert_eq!(t(&eval(r#"=BIN2HEX("1110")"#)), "E");
        assert_eq!(t(&eval(r#"=BIN2HEX("1111111111")"#)), "FFFFFFFFFF");
        assert_eq!(t(&eval(r#"=BIN2HEX("1001",2)"#)), "09");
        assert_eq!(e(&eval(r#"=BIN2HEX("102")"#)), CalcError::Num);
    }

    #[test]
    fn uppercase_digits() {
        assert_eq!(t(&eval(r#"=BIN2HEX("11111111")"#)), "FF");
        assert_eq!(t(&eval(r#"=BIN2HEX("1010")"#)), "A");
    }

    #[test]
    fn negative_ignores_places() {
        assert_eq!(t(&eval(r#"=BIN2HEX("1000000000")"#)), "FFFFFFFE00");
        assert_eq!(t(&eval(r#"=BIN2HEX("1111111111",3)"#)), "FFFFFFFFFF");
    }

    #[test]
    fn places_too_small_num() {
        // "111111111" -> "1FF" needs 3 places; 2 is too few.
        assert_eq!(e(&eval(r#"=BIN2HEX("111111111",2)"#)), CalcError::Num);
    }

    #[test]
    fn places_range_num() {
        assert_eq!(e(&eval(r#"=BIN2HEX("1",-1)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=BIN2HEX("1",11)"#)), CalcError::Num);
    }

    #[test]
    fn places_truncates() {
        assert_eq!(t(&eval(r#"=BIN2HEX("1",3.9)"#)), "001");
    }

    #[test]
    fn invalid_binary_num() {
        assert_eq!(e(&eval(r#"=BIN2HEX("2")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=BIN2HEX("11111111111")"#)), CalcError::Num);
    }

    #[test]
    fn places_bad_text() {
        // SPEC-OPEN: spec docs #VALUE! vs #NUM! for non-numeric places.
        assert_eq!(e(&eval(r#"=BIN2HEX("1","x")"#)), CalcError::Value);
    }

    #[test]
    fn numeric_arg() {
        assert_eq!(t(&eval("=BIN2HEX(1110)")), "E");
    }

    #[test]
    fn blank_ref() {
        assert_eq!(t(&eval("=BIN2HEX(A1)")), "0");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BIN2HEX(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=BIN2HEX("1",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BIN2HEX()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=BIN2HEX("1",2,3)"#)), CalcError::Value);
    }
}
