//! `OCT2BIN(number, [places])` — octal string to binary text.
//! Spec: `docs/functions/OCT2BIN.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::number::format_radix;
use crate::engineering::dec2bin::eval_places;
use crate::engineering::oct2dec::eval_octal;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let n = match eval_octal(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    // Binary output is capped at 10 digits: valid range −512..511
    // (`docs/functions/OCT2BIN.md`; e.g. octal `1000` = 512 -> #NUM!).
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
        assert_eq!(t(&eval(r#"=OCT2BIN("3")"#)), "11");
        assert_eq!(t(&eval(r#"=OCT2BIN("7777777777")"#)), "1111111111");
        assert_eq!(t(&eval(r#"=OCT2BIN("3",3)"#)), "011");
        assert_eq!(t(&eval(r#"=OCT2BIN("17")"#)), "1111");
        assert_eq!(e(&eval(r#"=OCT2BIN("8")"#)), CalcError::Num);
    }

    #[test]
    fn range_bounds() {
        assert_eq!(t(&eval(r#"=OCT2BIN("777")"#)), "111111111");
        // 30-bit two's complement -512 is octal "7777777000" (see
        // oct2dec.rs: the spec doc's "7777000000" is a typo).
        assert_eq!(t(&eval(r#"=OCT2BIN("7777777000")"#)), "1000000000");
        // octal 1000 = 512 decimal -> out of binary range.
        assert_eq!(e(&eval(r#"=OCT2BIN("1000")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=OCT2BIN("7776777777")"#)), CalcError::Num);
    }

    #[test]
    fn negative_two_complement() {
        // octal 7777777776 = -2 -> 10-bit two's complement.
        assert_eq!(t(&eval(r#"=OCT2BIN("7777777776")"#)), "1111111110");
    }

    #[test]
    fn numeric_arg() {
        assert_eq!(t(&eval("=OCT2BIN(17)")), "1111");
        assert_eq!(e(&eval("=OCT2BIN(19)")), CalcError::Num);
    }

    #[test]
    fn places_padding() {
        assert_eq!(t(&eval(r#"=OCT2BIN("1",5)"#)), "00001");
        assert_eq!(t(&eval(r#"=OCT2BIN("7",3.9)"#)), "111");
    }

    #[test]
    fn places_errors() {
        assert_eq!(e(&eval(r#"=OCT2BIN("3",1)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=OCT2BIN("3",0)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=OCT2BIN("3",-1)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=OCT2BIN("3",11)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=OCT2BIN("3","x")"#)), CalcError::Value);
    }

    #[test]
    fn negative_ignores_places() {
        assert_eq!(t(&eval(r#"=OCT2BIN("7777777777",3)"#)), "1111111111");
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(t(&eval("=OCT2BIN(A1)")), "0");
    }

    #[test]
    fn boolean_num() {
        assert_eq!(e(&eval("=OCT2BIN(TRUE)")), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=OCT2BIN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=OCT2BIN()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=OCT2BIN("1",2,3)"#)), CalcError::Value);
    }
}
