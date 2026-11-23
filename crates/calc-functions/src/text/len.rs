//! `LEN(text)` — returns the number of characters in `text`.
//! Spec: `docs/functions/LEN.md`.
//!
//! Counts UTF-16 code units (`😀` → 2) so `LEN` agrees with the
//! positions `LEFT`/`RIGHT`/`MID` use; see
//! [`crate::common::text_index`] (SPEC-OPEN GEN-005).

use crate::common::{coercion, text_index};
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
        Ok(s) => Ok(Value::Number(text_index::len_units(&s) as f64)),
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
    fn basic() {
        assert_eq!(n(&eval(r#"=LEN("hello")"#)), 5.0);
    }

    #[test]
    fn empty_string() {
        assert_eq!(n(&eval(r#"=LEN("")"#)), 0.0);
    }

    #[test]
    fn spaces_count() {
        assert_eq!(n(&eval(r#"=LEN(" a  b ")"#)), 6.0);
    }

    #[test]
    fn number_coerces_then_counts() {
        assert_eq!(n(&eval("=LEN(123)")), 3.0);
        assert_eq!(n(&eval("=LEN(-1.5)")), 4.0);
    }

    #[test]
    fn boolean_counts_true_false() {
        assert_eq!(n(&eval("=LEN(TRUE)")), 4.0);
        assert_eq!(n(&eval("=LEN(FALSE)")), 5.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=LEN(A1)")), 0.0);
    }

    #[test]
    fn text_ref() {
        assert_eq!(n(&eval_with(&[("A1", "hi!".into())], "=LEN(A1)")), 3.0);
    }

    #[test]
    fn non_bmp_counts_utf16_units() {
        assert_eq!(n(&eval(r#"=LEN("😀")"#)), 2.0);
        assert_eq!(n(&eval(r#"=LEN("é")"#)), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=LEN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=LEN()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=LEN("a","b")"#)), CalcError::Value);
    }
}
