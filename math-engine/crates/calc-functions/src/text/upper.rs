//! `UPPER(text)` — converts text to uppercase.
//! Spec: `docs/functions/UPPER.md`.
//!
//! Uses full Unicode case mapping (`str::to_uppercase`), so `ß` maps
//! to `SS`; Excel versions differ on such mappings — differences are
//! recorded as fixtures per the spec doc's open questions.

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
        Ok(s) => Ok(Value::Text(s.to_uppercase())),
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
        assert_eq!(t(&eval(r#"=UPPER("aBc123")"#)), "ABC123");
    }

    #[test]
    fn already_upper() {
        assert_eq!(t(&eval(r#"=UPPER("ABC")"#)), "ABC");
    }

    #[test]
    fn empty() {
        assert_eq!(t(&eval(r#"=UPPER("")"#)), "");
    }

    #[test]
    fn digits_and_punct_unchanged() {
        assert_eq!(t(&eval(r#"=UPPER("a-b_c!")"#)), "A-B_C!");
    }

    #[test]
    fn unicode_accented() {
        assert_eq!(t(&eval(r#"=UPPER("café")"#)), "CAFÉ");
    }

    #[test]
    fn unicode_sharp_s_full_mapping() {
        // Unicode full case mapping: ß -> SS (Excel-version dependent).
        assert_eq!(t(&eval(r#"=UPPER("straße")"#)), "STRASSE");
    }

    #[test]
    fn number_coerces() {
        assert_eq!(t(&eval("=UPPER(12.5)")), "12.5");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=UPPER(TRUE)")), "TRUE");
    }

    #[test]
    fn blank_ref_is_empty() {
        assert_eq!(t(&eval("=UPPER(A1)")), "");
    }

    #[test]
    fn text_ref() {
        assert_eq!(t(&eval_with(&[("A1", "abc".into())], "=UPPER(A1)")), "ABC");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=UPPER(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=UPPER()")), CalcError::Value);
    }
}
