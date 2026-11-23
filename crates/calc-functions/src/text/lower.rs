//! `LOWER(text)` — converts text to lowercase.
//! Spec: `docs/functions/LOWER.md`.
//!
//! Uses full Unicode case mapping (`str::to_lowercase`); Excel-version
//! differences (e.g. `İ` → `i̇`) are recorded as fixtures per the spec
//! doc's open questions.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match coercion::eval_text(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(s) => Ok(Value::Text(s.to_lowercase())),
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
    fn basic() {
        assert_eq!(t(&eval(r#"=LOWER("AbC123")"#)), "abc123");
    }

    #[test]
    fn already_lower() {
        assert_eq!(t(&eval(r#"=LOWER("abc")"#)), "abc");
    }

    #[test]
    fn empty() {
        assert_eq!(t(&eval(r#"=LOWER("")"#)), "");
    }

    #[test]
    fn digits_and_punct_unchanged() {
        assert_eq!(t(&eval(r#"=LOWER("A-B_C!")"#)), "a-b_c!");
    }

    #[test]
    fn unicode_accented() {
        assert_eq!(t(&eval(r#"=LOWER("CAFÉ")"#)), "café");
    }

    #[test]
    fn unicode_capital_i_with_dot() {
        // Unicode full mapping: İ -> i + combining dot above.
        assert_eq!(t(&eval(r#"=LOWER("İ")"#)), "i\u{307}");
    }

    #[test]
    fn number_coerces() {
        assert_eq!(t(&eval("=LOWER(12.5)")), "12.5");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=LOWER(FALSE)")), "false");
    }

    #[test]
    fn blank_ref_is_empty() {
        assert_eq!(t(&eval("=LOWER(A1)")), "");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=LOWER(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=LOWER("a","b")"#)), CalcError::Value);
    }
}
