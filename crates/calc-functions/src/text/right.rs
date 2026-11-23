//! `RIGHT(text, [num_chars])` — returns the rightmost `num_chars`
//! characters of `text`. Spec: `docs/functions/RIGHT.md`.
//!
//! Same coercion and counting rules as `LEFT` (UTF-16 code units via
//! [`crate::common::text_index`]); the slice is taken from the end.

use crate::common::{coercion, text_index};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let text = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let n = if args.len() == 2 {
        match coercion::eval_number(ctx, &args[1])? {
            Ok(n) => n,
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        1.0
    };
    if !n.is_finite() || n < 0.0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let units = n.trunc().min(usize::MAX as f64) as usize;
    Ok(Value::Text(
        text_index::suffix_units(&text, units).to_string(),
    ))
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
        assert_eq!(t(&eval(r#"=RIGHT("hello",2)"#)), "lo");
    }

    #[test]
    fn default_num_chars_is_one() {
        assert_eq!(t(&eval(r#"=RIGHT("hello")"#)), "o");
    }

    #[test]
    fn num_chars_zero_is_empty() {
        assert_eq!(t(&eval(r#"=RIGHT("hello",0)"#)), "");
    }

    #[test]
    fn num_chars_over_length_returns_all() {
        assert_eq!(t(&eval(r#"=RIGHT("hi",99)"#)), "hi");
    }

    #[test]
    fn fractional_num_chars_truncates() {
        assert_eq!(t(&eval(r#"=RIGHT("hello",2.9)"#)), "lo");
    }

    #[test]
    fn negative_num_chars_is_value_error() {
        assert_eq!(e(&eval(r#"=RIGHT("hello",-1)"#)), CalcError::Value);
    }

    #[test]
    fn number_coerces_to_text() {
        assert_eq!(t(&eval("=RIGHT(1234,2)")), "34");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=RIGHT(FALSE,3)")), "LSE");
    }

    #[test]
    fn blank_ref_is_empty() {
        assert_eq!(t(&eval("=RIGHT(A1,3)")), "");
    }

    #[test]
    fn nonnumeric_num_chars_is_value_error() {
        assert_eq!(e(&eval(r#"=RIGHT("hello","x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=RIGHT(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn non_bmp_counts_utf16_units() {
        assert_eq!(t(&eval(r#"=RIGHT("x😀",2)"#)), "😀");
        assert_eq!(t(&eval(r#"=RIGHT("x😀",3)"#)), "x😀");
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=RIGHT()")), CalcError::Value);
    }
}
