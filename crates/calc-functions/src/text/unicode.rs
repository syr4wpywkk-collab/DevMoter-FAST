//! `UNICODE(text)` — the Unicode codepoint of the first character of
//! `text`. Spec: `docs/functions/UNICODE.md`.
//!
//! Only the first scalar value is inspected; supplementary-plane
//! characters return the full codepoint (`UNICODE("😀")` is 128512),
//! which matches Excel's surrogate-pair handling in `UNICODE` (unlike
//! `CODE`'s UTF-16-unit view — recorded in the spec doc). Empty text is
//! `#VALUE!`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let s = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    match s.chars().next() {
        Some(c) => Ok(Value::Number(c as u32 as f64)),
        None => Ok(Value::Error(CalcError::Value)),
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
        assert_eq!(n(&eval(r#"=UNICODE("A")"#)), 65.0);
    }

    #[test]
    fn first_char_only() {
        assert_eq!(n(&eval(r#"=UNICODE("Alphabet")"#)), 65.0);
    }

    #[test]
    fn bmp_nonascii() {
        assert_eq!(n(&eval(r#"=UNICODE("π")"#)), 960.0);
        assert_eq!(n(&eval(r#"=UNICODE("東京")"#)), 26481.0);
    }

    #[test]
    fn supplementary_plane() {
        assert_eq!(n(&eval(r#"=UNICODE("😀x")"#)), 128512.0);
    }

    #[test]
    fn empty_is_error() {
        assert_eq!(e(&eval(r#"=UNICODE("")"#)), CalcError::Value);
    }

    #[test]
    fn blank_cell_is_error() {
        // Blank coerces to "" — same #VALUE! as explicit empty text.
        let v = eval_with(&[("A1", Value::Blank)], "=UNICODE(A1)");
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn number_coerces_to_text() {
        // First char of "123" is '1' = 49.
        assert_eq!(n(&eval("=UNICODE(123)")), 49.0);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=UNICODE(TRUE)")), 84.0); // 'T'
    }

    #[test]
    fn roundtrips_unichar() {
        assert_eq!(n(&eval(r#"=UNICODE(UNICHAR(960))"#)), 960.0);
        assert_eq!(n(&eval(r#"=UNICODE(UNICHAR(128512))"#)), 128512.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=UNICODE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=UNICODE()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=UNICODE("a","b")"#)), CalcError::Value);
    }
}
