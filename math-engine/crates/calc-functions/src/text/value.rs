//! `VALUE(text)` — parses a text string into a number.
//! Spec: `docs/functions/VALUE.md`.
//!
//! Fixed en-US-locale parsing: surrounding whitespace ignored, optional
//! sign, `.` decimal point, `,` thousands separators only in valid
//! 3-digit grouping positions, `E`/`e` exponent, trailing `%` dividing
//! by 100, a `$` after the sign. Unparseable text (including `"1,2,3"`,
//! `"--3"`, `""`) is `#VALUE!`. The rules are `parse_number_text`'s, so
//! `VALUE("1,000")` and `"1,000"+0` agree. Date/time strings are outside
//! the subset (spec doc open questions) and error.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::{Value, parse_number_text};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval(&args[0])?;
    let result = match &v {
        Value::Text(s) => parse_number_text(s).ok_or(CalcError::Value),
        // `VALUE` of an empty/blank input is `#VALUE!` like `VALUE("")`.
        Value::Blank => Err(CalcError::Value),
        _ => v.to_number(),
    };
    match result {
        Ok(n) => Ok(Value::Number(n)),
        Err(e) => Ok(Value::Error(e)),
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
    fn integer_and_decimal() {
        assert_eq!(n(&eval(r#"=VALUE("123")"#)), 123.0);
        assert_eq!(n(&eval(r#"=VALUE("1.5")"#)), 1.5);
    }

    #[test]
    fn whitespace_and_sign() {
        assert_eq!(n(&eval(r#"=VALUE("  -42 ")"#)), -42.0);
        assert_eq!(n(&eval(r#"=VALUE("+7")"#)), 7.0);
    }

    #[test]
    fn thousands_grouping() {
        assert_eq!(n(&eval(r#"=VALUE(" 1,234.50 ")"#)), 1234.5);
        assert_eq!(n(&eval(r#"=VALUE("1,234,567")"#)), 1234567.0);
    }

    #[test]
    fn bad_grouping_is_value_error() {
        assert_eq!(e(&eval(r#"=VALUE("1,2,3")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUE("12,34")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUE(",123")"#)), CalcError::Value);
    }

    #[test]
    fn exponent() {
        assert_eq!(n(&eval(r#"=VALUE("1e3")"#)), 1000.0);
        assert_eq!(n(&eval(r#"=VALUE("1.5E-2")"#)), 0.015);
    }

    #[test]
    fn trailing_percent() {
        assert_eq!(n(&eval(r#"=VALUE("5%")"#)), 0.05);
    }

    #[test]
    fn unparseable_is_value_error() {
        assert_eq!(e(&eval(r#"=VALUE("abc")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUE("--3")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUE("")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUE("1.2.3")"#)), CalcError::Value);
    }

    #[test]
    fn number_passthrough_and_boolean() {
        assert_eq!(n(&eval("=VALUE(3.5)")), 3.5);
        assert_eq!(n(&eval("=VALUE(TRUE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_value_error() {
        assert_eq!(e(&eval("=VALUE(A1)")), CalcError::Value);
    }

    #[test]
    fn text_ref_parses() {
        assert_eq!(n(&eval_with(&[("A1", "12.5".into())], "=VALUE(A1)")), 12.5);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=VALUE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=VALUE()")), CalcError::Value);
    }
}
