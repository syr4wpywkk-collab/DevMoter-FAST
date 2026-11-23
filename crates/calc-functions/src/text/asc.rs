//! `ASC(text)` — converts full-width (double-byte) characters in
//! `text` to their half-width equivalents.
//! Spec: `docs/functions/ASC.md`.
//!
//! The fixed mapping table lives in [`crate::common::dbcs`]:
//! full-width ASCII `U+FF01..=U+FF5E` -> `U+0021..=U+007E`, the
//! full-width space `U+3000` -> `U+0020`, and full-width katakana ->
//! half-width katakana (voiced kana decompose to base + `ﾞ`/`ﾟ`;
//! SPEC-OPEN exact-table notes are in the spec doc). Characters with
//! no half-width equivalent pass through unchanged.

use crate::common::{coercion, dbcs};
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
        Ok(s) => Ok(Value::Text(dbcs::to_halfwidth(&s))),
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
    fn fullwidth_ascii_letters() {
        assert_eq!(t(&eval(r#"=ASC("ＡＢＣ")"#)), "ABC");
    }

    #[test]
    fn fullwidth_digits() {
        assert_eq!(t(&eval(r#"=ASC("１２３")"#)), "123");
    }

    #[test]
    fn fullwidth_space() {
        assert_eq!(t(&eval("=ASC(\"　\")")), " ");
    }

    #[test]
    fn fullwidth_punctuation() {
        assert_eq!(t(&eval(r#"=ASC("（ｔｅｓｔ）！")"#)), "(test)!");
    }

    #[test]
    fn fullwidth_katakana() {
        assert_eq!(t(&eval(r#"=ASC("カタカナ")"#)), "ｶﾀｶﾅ");
    }

    #[test]
    fn voiced_katakana_decomposes() {
        assert_eq!(t(&eval(r#"=ASC("ガ")"#)), "ｶﾞ");
        assert_eq!(t(&eval(r#"=ASC("パ")"#)), "ﾊﾟ");
    }

    #[test]
    fn halfwidth_unchanged() {
        assert_eq!(t(&eval(r#"=ASC("abc")"#)), "abc");
        assert_eq!(t(&eval(r#"=ASC("ｶﾀｶﾅ")"#)), "ｶﾀｶﾅ");
    }

    #[test]
    fn no_equivalent_passes_through() {
        assert_eq!(t(&eval(r#"=ASC("東京都")"#)), "東京都");
    }

    #[test]
    fn number_coerces() {
        assert_eq!(t(&eval("=ASC(12)")), "12");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=ASC(TRUE)")), "TRUE");
    }

    #[test]
    fn blank_ref_is_empty() {
        assert_eq!(t(&eval("=ASC(A1)")), "");
    }

    #[test]
    fn mixed_text() {
        assert_eq!(t(&eval(r#"=ASC("Ａ1ｶ")"#)), "A1ｶ");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ASC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ASC()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=ASC("a","b")"#)), CalcError::Value);
    }
}
