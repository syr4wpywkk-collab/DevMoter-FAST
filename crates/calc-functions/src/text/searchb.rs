//! `SEARCHB(find_text, within_text, [start_num])` — byte-oriented
//! `SEARCH`: case-insensitive, wildcard-aware search returning the
//! **byte** position in the DBCS model
//! ([`crate::common::text_bytes`]). Spec: `docs/functions/SEARCHB.md`.
//!
//! Matching is identical to `SEARCH` (`?` one character, `*` any run,
//! `~` escapes — per the spec doc `?` counts one *character*, not one
//! byte; recorded SPEC-OPEN). `start_num` is in bytes; a start inside a
//! double-byte character rounds forward to the next character.
//! Positions reported are 1-based byte offsets; ASCII input is
//! identical to `SEARCH`.

use super::search;
use crate::common::{coercion, text_bytes};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let find = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let within = match coercion::eval_text(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let start = match coercion::eval_opt_number(ctx, args.get(2), 1.0)? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if !start.is_finite() || start < 1.0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let total = text_bytes::len_bytes(&within).max(1);
    let start0 = (start.trunc() - 1.0).min(usize::MAX as f64) as usize;
    if start0 >= total {
        return Ok(Value::Error(CalcError::Value));
    }
    // Byte offset -> char index (rounds forward out of a wide char).
    let (start_char, _) = text_bytes::char_index_at_byte(&within, start0);
    if find.is_empty() {
        // Position of the start character, 1-based bytes.
        return Ok(Value::Number(
            (text_bytes::byte_pos_of_char(&within, start_char) + 1) as f64,
        ));
    }
    let pattern = search::compile(&find);
    let chars: Vec<char> = within.chars().collect();
    for i in start_char..chars.len() {
        if search::match_prefix(&pattern, &chars[i..]) {
            return Ok(Value::Number(
                (text_bytes::byte_pos_of_char(&within, i) + 1) as f64,
            ));
        }
    }
    Ok(Value::Error(CalcError::Value))
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
    fn ascii_same_as_search() {
        assert_eq!(n(&eval(r#"=SEARCHB("B","abc")"#)), 2.0);
        assert_eq!(n(&eval(r#"=SEARCHB("b*n","banana")"#)), 1.0);
    }

    #[test]
    fn dbcs_byte_position() {
        // 東 = bytes 1-2, so 京 starts at byte 3.
        assert_eq!(n(&eval(r#"=SEARCHB("京","東京都")"#)), 3.0);
        assert_eq!(n(&eval(r#"=SEARCHB("都","東京都")"#)), 5.0);
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(n(&eval(r#"=SEARCHB("E","Statements")"#)), 5.0);
    }

    #[test]
    fn wildcards() {
        assert_eq!(n(&eval(r#"=SEARCHB("b?n","banana")"#)), 1.0);
        assert_eq!(n(&eval(r#"=SEARCHB("~?","a?b")"#)), 2.0);
    }

    #[test]
    fn no_match_is_value_error() {
        assert_eq!(e(&eval(r#"=SEARCHB("x","abc")"#)), CalcError::Value);
    }

    #[test]
    fn start_num_in_bytes() {
        // Byte 3 = start of 京; searching "京" from byte 3 finds 3.
        assert_eq!(n(&eval(r#"=SEARCHB("京","東京都",3)"#)), 3.0);
        // Byte 2 is inside 東: rounds forward to 京 (byte 3), then "都" at 5.
        assert_eq!(n(&eval(r#"=SEARCHB("都","東京都",2)"#)), 5.0);
    }

    #[test]
    fn start_out_of_range() {
        assert_eq!(e(&eval(r#"=SEARCHB("a","abc",4)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=SEARCHB("a","東京都",7)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=SEARCHB("a","abc",0)"#)), CalcError::Value);
    }

    #[test]
    fn empty_find_returns_start_byte() {
        assert_eq!(n(&eval(r#"=SEARCHB("","東京都")"#)), 1.0);
        // start byte 3 -> char index 1 (京) -> byte position 3.
        assert_eq!(n(&eval(r#"=SEARCHB("","東京都",3)"#)), 3.0);
    }

    #[test]
    fn mixed_width_position() {
        // "a東b": b is at byte 4.
        assert_eq!(n(&eval(r#"=SEARCHB("b","a東b")"#)), 4.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=SEARCHB(1/0,"abc")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=SEARCHB("a",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=SEARCHB("a")"#)), CalcError::Value);
    }
}
