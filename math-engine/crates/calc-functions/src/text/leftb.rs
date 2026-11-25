//! `LEFTB(text, [num_bytes])` — byte-oriented variant of `LEFT`:
//! returns the leftmost `num_bytes` bytes of `text`.
//! Spec: `docs/functions/LEFTB.md`.
//!
//! Byte widths come from the shared DBCS model in
//! [`crate::common::dbcs`]. A double-byte character is never split:
//! if `num_bytes` falls inside one, the partial character is dropped
//! (`LEFTB("東",1)` -> `""`). `num_bytes` defaults to 1, truncates
//! toward zero, and must be >= 0.

use crate::common::{coercion, dbcs};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let text = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let n = match coercion::eval_opt_number(ctx, args.get(1), 1.0)? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if !n.is_finite() || n < 0.0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let bytes = n.trunc().min(usize::MAX as f64) as usize;
    Ok(Value::Text(dbcs::prefix_bytes(&text, bytes).to_string()))
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
    fn ascii_basic() {
        assert_eq!(t(&eval(r#"=LEFTB("abc",2)"#)), "ab");
    }

    #[test]
    fn default_is_one() {
        assert_eq!(t(&eval(r#"=LEFTB("abc")"#)), "a");
    }

    #[test]
    fn double_byte_exact() {
        assert_eq!(t(&eval(r#"=LEFTB("東京都",4)"#)), "東京");
    }

    #[test]
    fn partial_char_dropped() {
        assert_eq!(t(&eval(r#"=LEFTB("東京都",3)"#)), "東");
        assert_eq!(t(&eval(r#"=LEFTB("東",1)"#)), "");
    }

    #[test]
    fn zero_is_empty() {
        assert_eq!(t(&eval(r#"=LEFTB("abc",0)"#)), "");
    }

    #[test]
    fn over_length_returns_all() {
        assert_eq!(t(&eval(r#"=LEFTB("東",99)"#)), "東");
    }

    #[test]
    fn fractional_truncates() {
        assert_eq!(t(&eval(r#"=LEFTB("abc",2.9)"#)), "ab");
    }

    #[test]
    fn negative_is_value_error() {
        assert_eq!(e(&eval(r#"=LEFTB("abc",-1)"#)), CalcError::Value);
    }

    #[test]
    fn number_coerces() {
        assert_eq!(t(&eval("=LEFTB(1234,2)")), "12");
    }

    #[test]
    fn blank_ref_is_empty() {
        assert_eq!(t(&eval("=LEFTB(A1,3)")), "");
    }

    #[test]
    fn nonnumeric_num_bytes_is_value_error() {
        assert_eq!(e(&eval(r#"=LEFTB("abc","x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=LEFTB(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=LEFTB("x",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=LEFTB()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=LEFTB("a",1,2)"#)), CalcError::Value);
    }
}
