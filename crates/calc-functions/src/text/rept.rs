//! `REPT(text, number_times)` — `text` repeated `number_times` times.
//! Spec: `docs/functions/REPT.md`.
//!
//! `number_times` truncates toward zero; `0` or empty `text` yields `""`;
//! negative is `#VALUE!`. Results exceeding Excel's 32,767-character
//! cell limit are `#VALUE!` (the spec's documented Excel behavior — the
//! shared text cap reports `#CALC!` in `TEXTJOIN`, so the error identity
//! is recorded as an open question in the spec doc).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Excel's maximum cell text length (shared cap, see `textjoin.rs`).
const MAX_TEXT_LEN: usize = 32_767;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let text = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let times = match coercion::eval_number(ctx, &args[1])? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if !times.is_finite() || times < 0.0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let count = times.trunc().min(usize::MAX as f64) as usize;
    if count > 0 && text.len() > MAX_TEXT_LEN / count {
        return Ok(Value::Error(CalcError::Value));
    }
    Ok(Value::Text(text.repeat(count)))
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
    fn repeats_text() {
        assert_eq!(t(&eval(r#"=REPT("ab",3)"#)), "ababab");
        assert_eq!(t(&eval(r#"=REPT("*",5)"#)), "*****");
    }

    #[test]
    fn zero_times_is_empty() {
        assert_eq!(t(&eval(r#"=REPT("x",0)"#)), "");
    }

    #[test]
    fn fractional_times_truncates() {
        assert_eq!(t(&eval(r#"=REPT("x",2.9)"#)), "xx");
        assert_eq!(t(&eval(r#"=REPT("x",0.5)"#)), "");
    }

    #[test]
    fn negative_times_is_error() {
        assert_eq!(e(&eval(r#"=REPT("x",-1)"#)), CalcError::Value);
    }

    #[test]
    fn empty_text_stays_empty() {
        assert_eq!(t(&eval(r#"=REPT("",10)"#)), "");
    }

    #[test]
    fn numbers_coerce() {
        assert_eq!(t(&eval("=REPT(7,3)")), "777");
        assert_eq!(t(&eval(r#"=REPT("x","3")"#)), "xxx");
    }

    #[test]
    fn bool_coerces_to_text() {
        assert_eq!(t(&eval("=REPT(TRUE,2)")), "TRUETRUE");
    }

    #[test]
    fn blank_text_is_empty() {
        let v = eval_with(&[("A1", Value::Blank)], r#"=REPT(A1,3)"#);
        assert_eq!(t(&v), "");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=REPT(1/0,2)")), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=REPT("x",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=REPT("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=REPT("x",1,2)"#)), CalcError::Value);
    }

    #[test]
    fn overflow_is_value_error() {
        assert_eq!(e(&eval(r#"=REPT("ab",20000)"#)), CalcError::Value);
        // Exactly at the cap succeeds.
        let v = eval(r#"=REPT("a",32767)"#);
        assert_eq!(t(&v).len(), 32767);
    }
}
