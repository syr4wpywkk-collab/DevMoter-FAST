//! `DBCS(text)` — converts half-width (single-byte) characters in
//! `text` to their full-width equivalents; inverse of `ASC` and
//! equivalent to `JIS`. Spec: `docs/functions/DBCS.md`.
//!
//! The fixed mapping table lives in [`crate::common::dbcs`]:
//! `U+0021..=U+007E` -> `U+FF01..=U+FF5E`, space -> `U+3000`, and
//! half-width katakana -> full-width katakana with `ﾞ`/`ﾟ`
//! composition (SPEC-OPEN notes in the spec doc). Characters with no
//! full-width equivalent pass through unchanged.

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
        Ok(s) => Ok(Value::Text(dbcs::to_fullwidth(&s))),
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
    fn ascii_letters() {
        assert_eq!(t(&eval(r#"=DBCS("ABC")"#)), "ＡＢＣ");
    }

    #[test]
    fn ascii_digits() {
        assert_eq!(t(&eval(r#"=DBCS("123")"#)), "１２３");
    }

    #[test]
    fn space_to_fullwidth_space() {
        assert_eq!(t(&eval(r#"=DBCS(" ")"#)), "　");
    }

    #[test]
    fn halfwidth_katakana() {
        assert_eq!(t(&eval(r#"=DBCS("ｶﾀｶﾅ")"#)), "カタカナ");
    }

    #[test]
    fn dakuten_composes() {
        assert_eq!(t(&eval(r#"=DBCS("ｶﾞ")"#)), "ガ");
        assert_eq!(t(&eval(r#"=DBCS("ﾊﾟ")"#)), "パ");
    }

    #[test]
    fn uncomposable_mark_stays_separate() {
        // ﾅ has no voiced form: the mark maps alone to ゛.
        assert_eq!(t(&eval(r#"=DBCS("ﾅﾞ")"#)), "ナ゛");
    }

    #[test]
    fn fullwidth_unchanged() {
        assert_eq!(t(&eval(r#"=DBCS("ＡＢＣ")"#)), "ＡＢＣ");
    }

    #[test]
    fn punctuation_maps() {
        assert_eq!(t(&eval(r#"=DBCS("｡｢｣､･")"#)), "。「」、・");
    }

    #[test]
    fn number_coerces() {
        assert_eq!(t(&eval("=DBCS(12)")), "１２");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=DBCS(TRUE)")), "ＴＲＵＥ");
    }

    #[test]
    fn blank_ref_is_empty() {
        assert_eq!(t(&eval("=DBCS(A1)")), "");
    }

    #[test]
    fn asc_round_trip() {
        assert_eq!(t(&eval(r#"=ASC(DBCS("ｶﾀｶﾅ ABC"))"#)), "ｶﾀｶﾅ ABC");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DBCS(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DBCS()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=DBCS("a","b")"#)), CalcError::Value);
    }
}
