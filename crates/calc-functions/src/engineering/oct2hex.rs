//! `OCT2HEX(number, [places])` — octal string to hexadecimal text.
//! Spec: `docs/functions/OCT2HEX.md`.

use calc_core::ast::Expr;
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
    let places = match eval_places(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    // Every 30-bit octal value fits the 10-character hex field, so no
    // extra range check is needed (negative -> 10-char two's
    // complement, `places` ignored — `docs/functions/OCT2HEX.md`).
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
        assert_eq!(t(&eval(r#"=OCT2HEX("100")"#)), "40");
        assert_eq!(t(&eval(r#"=OCT2HEX("7777777777")"#)), "FFFFFFFFFF");
        assert_eq!(t(&eval(r#"=OCT2HEX("54",4)"#)), "002C");
        assert_eq!(t(&eval(r#"=OCT2HEX("777")"#)), "1FF");
        assert_eq!(e(&eval(r#"=OCT2HEX("99")"#)), CalcError::Num);
    }

    #[test]
    fn positive_small() {
        assert_eq!(t(&eval(r#"=OCT2HEX("7")"#)), "7");
        assert_eq!(t(&eval(r#"=OCT2HEX("10")"#)), "8");
        assert_eq!(t(&eval(r#"=OCT2HEX("0")"#)), "0");
    }

    #[test]
    fn negative_two_complement() {
        // octal 7777777776 = -2 -> FFFFFFFFFE
        assert_eq!(t(&eval(r#"=OCT2HEX("7777777776")"#)), "FFFFFFFFFE");
        // octal 7777777000 = -512 -> FFFFFFE00 (see oct2dec.rs re the
        // spec doc's "7777000000" typo); octal 7777000000 = -262144.
        assert_eq!(t(&eval(r#"=OCT2HEX("7777777000")"#)), "FFFFFFFE00");
        assert_eq!(t(&eval(r#"=OCT2HEX("7777000000")"#)), "FFFFFC0000");
    }

    #[test]
    fn large_positive() {
        // 30-bit max positive: 3777777777 octal = 0x1FFFFFFF
        assert_eq!(t(&eval(r#"=OCT2HEX("3777777777")"#)), "1FFFFFFF");
    }

    #[test]
    fn numeric_arg() {
        assert_eq!(t(&eval("=OCT2HEX(100)")), "40");
        assert_eq!(e(&eval("=OCT2HEX(108)")), CalcError::Num);
    }

    #[test]
    fn places_padding() {
        assert_eq!(t(&eval(r#"=OCT2HEX("54",10)"#)), "000000002C");
        assert_eq!(t(&eval(r#"=OCT2HEX("54",3.9)"#)), "02C");
    }

    #[test]
    fn places_errors() {
        assert_eq!(e(&eval(r#"=OCT2HEX("777",2)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=OCT2HEX("1",-1)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=OCT2HEX("1",11)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=OCT2HEX("1","x")"#)), CalcError::Value);
    }

    #[test]
    fn negative_ignores_places() {
        assert_eq!(t(&eval(r#"=OCT2HEX("7777777777",4)"#)), "FFFFFFFFFF");
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(t(&eval("=OCT2HEX(A1)")), "0");
    }

    #[test]
    fn boolean_num() {
        assert_eq!(e(&eval("=OCT2HEX(TRUE)")), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=OCT2HEX(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=OCT2HEX()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=OCT2HEX("1",2,3)"#)), CalcError::Value);
    }
}
