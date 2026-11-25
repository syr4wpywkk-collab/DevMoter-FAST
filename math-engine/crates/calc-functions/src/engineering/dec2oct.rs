//! `DEC2OCT(number, [places])` — decimal integer to octal text.
//! Spec: `docs/functions/DEC2OCT.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::number::format_radix;
use crate::engineering::dec2bin::{eval_decimal, eval_places};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    // Domain: [-2^29, 2^29 - 1] (docs/functions/DEC2OCT.md).
    let n = match eval_decimal(ctx, &args[0], -536_870_912.0, 536_870_911.0)? {
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
        assert_eq!(t(&eval("=DEC2OCT(58,3)")), "072");
        assert_eq!(t(&eval("=DEC2OCT(-100)")), "7777777634");
        assert_eq!(t(&eval("=DEC2OCT(8)")), "10");
        assert_eq!(e(&eval("=DEC2OCT(536870912)")), CalcError::Num);
    }

    #[test]
    fn negative_one() {
        assert_eq!(t(&eval("=DEC2OCT(-1)")), "7777777777");
        assert_eq!(t(&eval("=DEC2OCT(-536870912)")), "4000000000");
    }

    #[test]
    fn fraction_truncates() {
        assert_eq!(t(&eval("=DEC2OCT(58.9)")), "72");
    }

    #[test]
    fn places_too_small_num() {
        // "72" fits in 2 places; 1 is too few.
        assert_eq!(t(&eval("=DEC2OCT(58,2)")), "72");
        assert_eq!(e(&eval("=DEC2OCT(58,1)")), CalcError::Num);
    }

    #[test]
    fn places_range_num() {
        assert_eq!(e(&eval("=DEC2OCT(1,-1)")), CalcError::Num);
        assert_eq!(e(&eval("=DEC2OCT(1,11)")), CalcError::Num);
    }

    #[test]
    fn negative_ignores_places() {
        assert_eq!(t(&eval("=DEC2OCT(-1,3)")), "7777777777");
    }

    #[test]
    fn text_coerces() {
        assert_eq!(t(&eval(r#"=DEC2OCT("58",3)"#)), "072");
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=DEC2OCT("x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(t(&eval("=DEC2OCT(A1)")), "0");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DEC2OCT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DEC2OCT()")), CalcError::Value);
        assert_eq!(e(&eval("=DEC2OCT(1,2,3)")), CalcError::Value);
    }
}
