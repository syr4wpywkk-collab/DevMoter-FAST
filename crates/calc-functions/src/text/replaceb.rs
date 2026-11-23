//! `REPLACEB(old_text, start_num, num_bytes, new_text)` — byte-oriented
//! `REPLACE` in the DBCS model ([`crate::common::text_bytes`]).
//! Spec: `docs/functions/REPLACEB.md`.
//!
//! `start_num` is a 1-based byte position (`< 1` -> `#VALUE!`),
//! `num_bytes` a byte count (`< 0` -> `#VALUE!`); both truncate toward
//! zero. `num_bytes = 0` inserts; `start_num` past the end appends.
//! When the byte range cuts through double-byte characters, the cut
//! characters are removed whole (removal boundary, per the spec doc's
//! expected rule — SPEC-OPEN recorded in `common::text_bytes`).

use crate::common::{coercion, text_bytes};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
        return Ok(Value::Error(e));
    }
    let old = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let start = match coercion::eval_number(ctx, &args[1])? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let count = match coercion::eval_number(ctx, &args[2])? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let new = match coercion::eval_text(ctx, &args[3])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    if !start.is_finite() || !count.is_finite() || start < 1.0 || count < 0.0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let start0 = (start.trunc() - 1.0).min(usize::MAX as f64) as usize;
    let num = count.trunc().min(usize::MAX as f64) as usize;
    let (head, tail) = text_bytes::remove_byte_range(&old, start0, num);
    let mut out = String::with_capacity(head.len() + new.len() + tail.len());
    out.push_str(head);
    out.push_str(&new);
    out.push_str(tail);
    Ok(Value::Text(out))
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
    fn dbcs_replaces_whole_chars() {
        // 東 bytes 1-2, 京 bytes 3-4: remove 京, insert 市.
        assert_eq!(t(&eval(r#"=REPLACEB("東京都",3,2,"市")"#)), "東市都");
    }

    #[test]
    fn ascii_same_as_replace() {
        assert_eq!(t(&eval(r#"=REPLACEB("abcdef",2,3,"X")"#)), "aXef");
    }

    #[test]
    fn append_past_end() {
        assert_eq!(t(&eval(r#"=REPLACEB("abc",4,1,"d")"#)), "abcd");
        assert_eq!(t(&eval(r#"=REPLACEB("東京都",9,1,"x")"#)), "東京都x");
    }

    #[test]
    fn insert_zero_bytes() {
        assert_eq!(t(&eval(r#"=REPLACEB("abc",1,0,"X")"#)), "Xabc");
        assert_eq!(t(&eval(r#"=REPLACEB("abc",4,0,"d")"#)), "abcd");
    }

    #[test]
    fn insert_inside_wide_char() {
        // start_num=2 cuts through 東 (bytes 1-2): the removal range is
        // empty but the start boundary... per the removal-expansion
        // rule the char it touches is removed whole -> "市京都".
        assert_eq!(t(&eval(r#"=REPLACEB("東京都",2,0,"市")"#)), "市京都");
    }

    #[test]
    fn cut_chars_removed_whole() {
        // Remove bytes 2..4: cuts 東 (1-2) and 京 (3-4) -> both go.
        assert_eq!(t(&eval(r#"=REPLACEB("東京都",2,2,"x")"#)), "x都");
        // Remove bytes 3..3 (num=1): inside 京 only -> 京 goes.
        assert_eq!(t(&eval(r#"=REPLACEB("東京都",3,1,"x")"#)), "東x都");
    }

    #[test]
    fn start_zero_is_error() {
        assert_eq!(e(&eval(r#"=REPLACEB("abc",0,1,"X")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=REPLACEB("abc",-1,1,"X")"#)), CalcError::Value);
    }

    #[test]
    fn negative_count_is_error() {
        assert_eq!(e(&eval(r#"=REPLACEB("abc",1,-1,"X")"#)), CalcError::Value);
    }

    #[test]
    fn fractional_truncates() {
        assert_eq!(t(&eval(r#"=REPLACEB("abcdef",2.9,2.9,"X")"#)), "aXdef");
    }

    #[test]
    fn numbers_coerce() {
        assert_eq!(t(&eval("=REPLACEB(12345,2,3,9)")), "195");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=REPLACEB(1/0,1,1,"x")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=REPLACEB("x",1,1,1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=REPLACEB("a",1,1)"#)), CalcError::Value);
    }
}
