//! `LENB(text)` — byte-oriented variant of `LEN`: returns the byte
//! length of `text` where double-byte characters count as 2.
//! Spec: `docs/functions/LENB.md`.
//!
//! Byte widths come from the shared DBCS model in
//! [`crate::common::dbcs`] (ASCII and half-width katakana count 1,
//! everything else 2; SPEC-OPEN notes in the module docs).

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
        Ok(s) => Ok(Value::Number(dbcs::len_bytes(&s) as f64)),
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
    fn ascii() {
        assert_eq!(n(&eval(r#"=LENB("abc")"#)), 3.0);
    }

    #[test]
    fn double_byte() {
        assert_eq!(n(&eval(r#"=LENB("東京都")"#)), 6.0);
    }

    #[test]
    fn mixed() {
        assert_eq!(n(&eval(r#"=LENB("a東")"#)), 3.0);
        assert_eq!(n(&eval(r#"=LENB("A1東")"#)), 4.0);
    }

    #[test]
    fn empty() {
        assert_eq!(n(&eval(r#"=LENB("")"#)), 0.0);
    }

    #[test]
    fn halfwidth_katakana_is_single() {
        assert_eq!(n(&eval(r#"=LENB("ｶﾀ")"#)), 2.0);
    }

    #[test]
    fn fullwidth_katakana_is_double() {
        assert_eq!(n(&eval(r#"=LENB("カタ")"#)), 4.0);
    }

    #[test]
    fn number_coerces_then_counts() {
        assert_eq!(n(&eval("=LENB(123)")), 3.0);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=LENB(TRUE)")), 4.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=LENB(A1)")), 0.0);
    }

    #[test]
    fn text_ref() {
        assert_eq!(n(&eval_with(&[("A1", "東".into())], "=LENB(A1)")), 2.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=LENB(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=LENB()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=LENB("a","b")"#)), CalcError::Value);
    }
}
