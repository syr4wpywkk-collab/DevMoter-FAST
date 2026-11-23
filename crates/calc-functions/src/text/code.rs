//! `CODE(text)` — returns the numeric code of the first character of
//! `text`, the inverse of `CHAR`. Spec: `docs/functions/CODE.md`.
//!
//! Uses `CHAR`'s fixed codepage (ASCII + Windows-1252). Empty text is
//! `#VALUE!`; a character with no CP1252 mapping returns `63` (`?`),
//! emulating the best-fit fallback of Excel's ANSI builds (SPEC-OPEN
//! in the spec doc: `63` vs `#VALUE!`).

use crate::common::coercion;
use crate::text::char::cp1252_code;
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
    let Some(c) = s.chars().next() else {
        return Ok(Value::Error(CalcError::Value));
    };
    let code = if c.is_ascii() {
        c as u32
    } else {
        cp1252_code(c).map(u32::from).unwrap_or(63)
    };
    Ok(Value::Number(code as f64))
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
        assert_eq!(n(&eval(r#"=CODE("A")"#)), 65.0);
    }

    #[test]
    fn first_char_only() {
        assert_eq!(n(&eval(r#"=CODE("Alphabet")"#)), 65.0);
    }

    #[test]
    fn empty_is_value_error() {
        assert_eq!(e(&eval(r#"=CODE("")"#)), CalcError::Value);
    }

    #[test]
    fn cp1252_high() {
        assert_eq!(n(&eval(r#"=CODE("é")"#)), 233.0);
        assert_eq!(n(&eval(r#"=CODE("€")"#)), 128.0);
    }

    #[test]
    fn unmapped_returns_question_mark() {
        assert_eq!(n(&eval(r#"=CODE("東")"#)), 63.0);
        assert_eq!(n(&eval(r#"=CODE("😀")"#)), 63.0);
    }

    #[test]
    fn number_coerces_first() {
        assert_eq!(n(&eval("=CODE(123)")), 49.0);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=CODE(TRUE)")), 84.0);
    }

    #[test]
    fn blank_ref_is_value_error() {
        assert_eq!(e(&eval("=CODE(A1)")), CalcError::Value);
    }

    #[test]
    fn char_inverse() {
        assert_eq!(n(&eval(r#"=CODE(CHAR(233))"#)), 233.0);
        assert_eq!(n(&eval(r#"=CODE(CHAR(65))"#)), 65.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=CODE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CODE()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=CODE("a","b")"#)), CalcError::Value);
    }
}
