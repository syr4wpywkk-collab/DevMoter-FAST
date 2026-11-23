//! `CLEAN(text)` — removes non-printable characters from `text`.
//! Spec: `docs/functions/CLEAN.md`.
//!
//! Removed set (the modern Unicode implementation documented in the
//! spec): codes `0..=31`, `127`, and the CP1252 non-printables
//! `129`, `141`, `143`, `144`, `157` (SPEC-OPEN — exact reference
//! list unconfirmed). Space (`32`) and non-breaking space (`160`)
//! are kept.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Whether `c` is in `CLEAN`'s removal set.
fn removed(c: char) -> bool {
    matches!(c as u32, 0..=31 | 127 | 129 | 141 | 143 | 144 | 157)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match coercion::eval_text(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(s) => Ok(Value::Text(s.chars().filter(|&c| !removed(c)).collect())),
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
    fn tab_removed() {
        assert_eq!(t(&eval(r#"=CLEAN(CHAR(9)&"abc")"#)), "abc");
    }

    #[test]
    fn line_feed_removed() {
        assert_eq!(t(&eval(r#"=CLEAN("a"&CHAR(10)&"b")"#)), "ab");
    }

    #[test]
    fn clean_text_unchanged() {
        assert_eq!(t(&eval(r#"=CLEAN("abc")"#)), "abc");
    }

    #[test]
    fn del_removed() {
        assert_eq!(t(&eval(r#"=CLEAN(CHAR(127)&"x")"#)), "x");
    }

    #[test]
    fn cp1252_nonprintables_removed() {
        assert_eq!(t(&eval(r#"=CLEAN(CHAR(141)&"x")"#)), "x");
        assert_eq!(t(&eval(r#"=CLEAN(CHAR(157)&"x")"#)), "x");
    }

    #[test]
    fn space_and_nbsp_kept() {
        assert_eq!(t(&eval(r#"=CLEAN(" a b ")"#)), " a b ");
        assert_eq!(t(&eval("=CLEAN(\"a\"&CHAR(160)&\"b\")")), "a\u{A0}b");
    }

    #[test]
    fn number_coerces() {
        assert_eq!(t(&eval("=CLEAN(123)")), "123");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=CLEAN(TRUE)")), "TRUE");
    }

    #[test]
    fn blank_ref_is_empty() {
        assert_eq!(t(&eval("=CLEAN(A1)")), "");
    }

    #[test]
    fn all_removed_is_empty() {
        assert_eq!(t(&eval("=CLEAN(CHAR(1)&CHAR(31))")), "");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=CLEAN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CLEAN()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=CLEAN("a","b")"#)), CalcError::Value);
    }
}
