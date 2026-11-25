//! `BIN2OCT(number, [places])` — binary string to octal text.
//! Spec: `docs/functions/BIN2OCT.md`.

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
        assert_eq!(t(&eval(r#"=BIN2OCT("1001",4)"#)), "0011");
        assert_eq!(t(&eval(r#"=BIN2OCT("1111111111")"#)), "7777777777");
        assert_eq!(t(&eval(r#"=BIN2OCT("1100100")"#)), "144");
        assert_eq!(t(&eval(r#"=BIN2OCT("100",2)"#)), "04");
        assert_eq!(e(&eval(r#"=BIN2OCT("2")"#)), CalcError::Num);
    }

    #[test]
    fn negative_ignores_places() {
        assert_eq!(t(&eval(r#"=BIN2OCT("1000000000",3)"#)), "7777777000");
    }

    #[test]
    fn places_too_small_num() {
        assert_eq!(e(&eval(r#"=BIN2OCT("111111111",2)"#)), CalcError::Num);
    }

    #[test]
    fn places_range_num() {
        assert_eq!(e(&eval(r#"=BIN2OCT("1",-1)"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=BIN2OCT("1",11)"#)), CalcError::Num);
    }

    #[test]
    fn places_truncates() {
        assert_eq!(t(&eval(r#"=BIN2OCT("1",4.9)"#)), "0001");
    }

    #[test]
    fn invalid_binary_num() {
        assert_eq!(e(&eval(r#"=BIN2OCT("1234")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=BIN2OCT("11111111111")"#)), CalcError::Num);
    }

    #[test]
    fn places_bad_text() {
        assert_eq!(e(&eval(r#"=BIN2OCT("1","x")"#)), CalcError::Value);
    }

    #[test]
    fn numeric_arg() {
        assert_eq!(t(&eval("=BIN2OCT(1001)")), "11");
    }

    #[test]
    fn blank_ref() {
        assert_eq!(t(&eval("=BIN2OCT(A1)")), "0");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BIN2OCT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BIN2OCT()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=BIN2OCT("1",2,3)"#)), CalcError::Value);
    }
}
