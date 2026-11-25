//! `FIND(find_text, within_text, [start_num])` — 1-based position of
//! `find_text` in `within_text`, case-sensitive, no wildcards.
//! Spec: `docs/functions/FIND.md`.
//!
//! Positions count UTF-16 code units ([`crate::common::text_index`]).
//! `start_num` defaults to 1 and must lie in `1..=max(LEN,1)` (an empty
//! `within_text` accepts only 1); empty `find_text` returns `start_num`.
//! No match or an out-of-range `start_num` is `#VALUE!`.

use crate::common::{coercion, text_index};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Validate `start_num` (1-based, truncated) against `within`'s length
/// in UTF-16 units and return its 0-based unit offset.
pub(crate) fn start_offset(start: f64, within: &str) -> Result<usize, CalcError> {
    if !start.is_finite() || start < 1.0 {
        return Err(CalcError::Value);
    }
    let start = start.trunc().min(usize::MAX as f64) as usize;
    let len = text_index::len_units(within).max(1);
    if start > len {
        return Err(CalcError::Value);
    }
    Ok(start - 1)
}

/// Byte offset where the search at 0-based unit offset `start0` begins.
pub(crate) fn byte_offset_at_start(s: &str, start0: usize) -> usize {
    // Start positions inside a surrogate pair include the whole pair
    // (see text_index docs), which matches the "start rounds down" rule.
    let mut acc = 0usize;
    let mut last = 0usize;
    for (b, c) in s.char_indices() {
        if acc > start0 {
            break;
        }
        last = b;
        acc += c.len_utf16();
    }
    if acc <= start0 { s.len() } else { last }
}

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
    let start = if args.len() == 3 {
        match coercion::eval_number(ctx, &args[2])? {
            Ok(n) => n,
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        1.0
    };
    let start0 = match start_offset(start, &within) {
        Ok(o) => o,
        Err(e) => return Ok(Value::Error(e)),
    };
    if find.is_empty() {
        return Ok(Value::Number((start0 + 1) as f64));
    }
    let byte0 = byte_offset_at_start(&within, start0);
    match within[byte0..].find(&find) {
        Some(rel) => {
            let pos = text_index::unit_offset_of_byte(&within, byte0 + rel);
            Ok(Value::Number((pos + 1) as f64))
        }
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
    fn case_sensitive() {
        assert_eq!(n(&eval(r#"=FIND("M","Miriam")"#)), 1.0);
        assert_eq!(n(&eval(r#"=FIND("m","Miriam")"#)), 6.0);
    }

    #[test]
    fn start_num() {
        // Inclusive start: the 'a' at position 4 itself is a candidate.
        // (docs/functions/FIND.md shows 5 — spec example discrepancy,
        // flagged in the fixture set.)
        assert_eq!(n(&eval(r#"=FIND("a","banana",4)"#)), 4.0);
        assert_eq!(n(&eval(r#"=FIND("a","banana",2)"#)), 2.0);
    }

    #[test]
    fn no_match_is_value_error() {
        assert_eq!(e(&eval(r#"=FIND("z","abc")"#)), CalcError::Value);
    }

    #[test]
    fn empty_find_returns_start() {
        assert_eq!(n(&eval(r#"=FIND("","abc")"#)), 1.0);
        assert_eq!(n(&eval(r#"=FIND("","abc",2)"#)), 2.0);
    }

    #[test]
    fn empty_within_with_empty_find() {
        assert_eq!(n(&eval(r#"=FIND("","")"#)), 1.0);
    }

    #[test]
    fn start_num_out_of_range() {
        assert_eq!(e(&eval(r#"=FIND("a","abc",4)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=FIND("a","abc",0)"#)), CalcError::Value);
    }

    #[test]
    fn wildcards_are_literal() {
        assert_eq!(n(&eval(r#"=FIND("?","a?b")"#)), 2.0);
        assert_eq!(e(&eval(r#"=FIND("*","abc")"#)), CalcError::Value);
    }

    #[test]
    fn numbers_coerce() {
        assert_eq!(n(&eval("=FIND(3,12345)")), 3.0);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval(r#"=FIND("RUE",TRUE)"#)), 2.0);
    }

    #[test]
    fn non_bmp_position_counts_units() {
        assert_eq!(n(&eval(r#"=FIND("x","😀x")"#)), 3.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=FIND(1/0,"abc")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=FIND("a",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=FIND("a")"#)), CalcError::Value);
    }
}
