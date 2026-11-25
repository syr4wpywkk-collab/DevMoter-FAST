//! `RIGHTB(text, [num_bytes])` — byte-oriented `RIGHT`: the rightmost
//! `num_bytes` bytes of `text` in the DBCS model
//! ([`crate::common::text_bytes`]). Spec: `docs/functions/RIGHTB.md`.
//!
//! `num_bytes` defaults to 1 and truncates toward zero; negative is
//! `#VALUE!`. A leading partial double-byte character is dropped (take
//! boundary). ASCII input is identical to `RIGHT`.

use crate::common::{coercion, text_bytes};
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
    let num = match coercion::eval_opt_number(ctx, args.get(1), 1.0)? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if !num.is_finite() || num < 0.0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let budget = num.trunc().min(usize::MAX as f64) as usize;
    Ok(Value::Text(
        text_bytes::suffix_bytes(&text, budget).to_string(),
    ))
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
    fn ascii_same_as_right() {
        assert_eq!(t(&eval(r#"=RIGHTB("abc",2)"#)), "bc");
        assert_eq!(t(&eval(r#"=RIGHTB("abc")"#)), "c");
    }

    #[test]
    fn dbcs_counts_two_per_char() {
        assert_eq!(t(&eval(r#"=RIGHTB("東京都",4)"#)), "京都");
        assert_eq!(t(&eval(r#"=RIGHTB("東京都",2)"#)), "都");
    }

    #[test]
    fn partial_leading_char_dropped() {
        // 3 bytes covers 都 (2) plus 1 byte into 京: 京 is dropped.
        assert_eq!(t(&eval(r#"=RIGHTB("東京都",3)"#)), "都");
        assert_eq!(t(&eval(r#"=RIGHTB("東京都",1)"#)), "");
    }

    #[test]
    fn over_length_returns_all() {
        assert_eq!(t(&eval(r#"=RIGHTB("東京都",99)"#)), "東京都");
        assert_eq!(t(&eval(r#"=RIGHTB("abc",10)"#)), "abc");
    }

    #[test]
    fn zero_bytes_empty() {
        assert_eq!(t(&eval(r#"=RIGHTB("abc",0)"#)), "");
    }

    #[test]
    fn negative_is_error() {
        assert_eq!(e(&eval(r#"=RIGHTB("abc",-1)"#)), CalcError::Value);
    }

    #[test]
    fn fractional_truncates() {
        assert_eq!(t(&eval(r#"=RIGHTB("abcd",2.9)"#)), "cd");
        // 3.9 bytes on 東京都 -> budget 3 -> "都".
        assert_eq!(t(&eval(r#"=RIGHTB("東京都",3.9)"#)), "都");
    }

    #[test]
    fn mixed_width() {
        // "ab東" : bytes a=1,b=1,東=2. RIGHTB(...,3) -> "b東"; (...,2) -> "東"
        assert_eq!(t(&eval(r#"=RIGHTB("ab東",3)"#)), "b東");
        assert_eq!(t(&eval(r#"=RIGHTB("ab東",2)"#)), "東");
    }

    #[test]
    fn number_coerces_to_text() {
        assert_eq!(t(&eval("=RIGHTB(1234,2)")), "34");
    }

    #[test]
    fn empty_text() {
        assert_eq!(t(&eval(r#"=RIGHTB("",3)"#)), "");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=RIGHTB(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=RIGHTB("x",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=RIGHTB()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=RIGHTB("a",1,2)"#)), CalcError::Value);
    }
}
