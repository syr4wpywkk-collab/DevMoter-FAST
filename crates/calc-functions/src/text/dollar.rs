//! `DOLLAR(number, [decimals])` — formats a number as currency text
//! with `$`, thousands separators and a fixed number of decimals.
//! Spec: `docs/functions/DOLLAR.md`.
//!
//! Fixed en-US convention (SPEC-OPEN in the spec doc: the currency
//! symbol and negative style may be locale-dependent in Excel):
//! `$` prefix and negatives render in accounting parentheses
//! `($1,234.57)`. Number formatting is shared with `FIXED` via
//! [`crate::common::number::format_fixed`].

use crate::common::{coercion, number};
use crate::text::fixed::eval_decimals;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let n = match coercion::eval_number(ctx, &args[0])? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let decimals = match eval_decimals(ctx, args.get(1), 2.0)? {
        Ok(d) => d,
        Err(e) => return Ok(Value::Error(e)),
    };
    let body = format!("${}", number::format_fixed(n.abs(), decimals, true));
    Ok(Value::Text(if n.is_sign_negative() && n != 0.0 {
        format!("({body})")
    } else {
        body
    }))
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
    fn basic() {
        assert_eq!(t(&eval("=DOLLAR(1234.567)")), "$1,234.57");
    }

    #[test]
    fn negative_parentheses() {
        assert_eq!(t(&eval("=DOLLAR(-1234.567)")), "($1,234.57)");
    }

    #[test]
    fn zero_decimals() {
        assert_eq!(t(&eval("=DOLLAR(99.5,0)")), "$100");
    }

    #[test]
    fn negative_decimals() {
        assert_eq!(t(&eval("=DOLLAR(1234.567,-2)")), "$1,200");
    }

    #[test]
    fn small_value_rounds() {
        assert_eq!(t(&eval("=DOLLAR(0.009,2)")), "$0.01");
    }

    #[test]
    fn zero() {
        assert_eq!(t(&eval("=DOLLAR(0)")), "$0.00");
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(t(&eval(r#"=DOLLAR("12.5")"#)), "$12.50");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=DOLLAR(TRUE)")), "$1.00");
    }

    #[test]
    fn blank_is_zero() {
        assert_eq!(t(&eval("=DOLLAR(A1)")), "$0.00");
    }

    #[test]
    fn decimals_truncates() {
        assert_eq!(t(&eval("=DOLLAR(1.05,1.9)")), "$1.1");
    }

    #[test]
    fn nonnumeric_is_value_error() {
        assert_eq!(e(&eval(r#"=DOLLAR("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=DOLLAR(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DOLLAR(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DOLLAR()")), CalcError::Value);
        assert_eq!(e(&eval("=DOLLAR(1,2,3)")), CalcError::Value);
    }
}
