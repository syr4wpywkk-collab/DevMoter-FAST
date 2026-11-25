//! `FINDB(find_text, within_text, [start_num])` — byte-oriented
//! variant of `FIND`: case-sensitive search returning a DBCS byte
//! position. Spec: `docs/functions/FINDB.md`.
//!
//! Byte positions use the shared DBCS model in
//! [`crate::common::dbcs`] (double-byte characters count 2).
//! `start_num` is a 1-based byte position, must lie in
//! `1..=max(LENB,1)`, and snaps forward to a character boundary.
//! Matching is identical to `FIND` (case-sensitive, no wildcards);
//! no match is `#VALUE!`.

use crate::common::{coercion, dbcs};
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
    let start = start.trunc().min(usize::MAX as f64) as usize;
    if start > dbcs::len_bytes(&within).max(1) {
        return Ok(Value::Error(CalcError::Value));
    }
    let start0 = start - 1;
    if find.is_empty() {
        return Ok(Value::Number((start0 + 1) as f64));
    }
    let byte0 = dbcs::byte_index_at(&within, start0);
    match within[byte0..].find(&find) {
        Some(rel) => {
            let pos = dbcs::len_bytes(&within[..byte0 + rel]);
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
    fn double_byte_positions() {
        // 東 occupies bytes 1-2; 京 starts at byte 3.
        assert_eq!(n(&eval(r#"=FINDB("京","東京都")"#)), 3.0);
    }

    #[test]
    fn ascii_matches_find() {
        assert_eq!(n(&eval(r#"=FINDB("b","abc")"#)), 2.0);
    }

    #[test]
    fn case_sensitive() {
        assert_eq!(e(&eval(r#"=FINDB("z","Miriam")"#)), CalcError::Value);
        assert_eq!(n(&eval(r#"=FINDB("m","Miriam")"#)), 6.0);
        assert_eq!(n(&eval(r#"=FINDB("M","Miriam")"#)), 1.0);
    }

    #[test]
    fn mixed_width() {
        assert_eq!(n(&eval(r#"=FINDB("b","a東b")"#)), 4.0);
    }

    #[test]
    fn start_num_bytes() {
        assert_eq!(n(&eval(r#"=FINDB("都","東京都",3)"#)), 5.0);
    }

    #[test]
    fn start_inside_char_snaps_forward() {
        // start_num=2 lands inside 東; search begins at 京 (byte 3).
        assert_eq!(n(&eval(r#"=FINDB("京","東京都",2)"#)), 3.0);
    }

    #[test]
    fn no_match_is_value_error() {
        assert_eq!(e(&eval(r#"=FINDB("z","abc")"#)), CalcError::Value);
    }

    #[test]
    fn empty_find_returns_start() {
        assert_eq!(n(&eval(r#"=FINDB("","abc")"#)), 1.0);
        assert_eq!(n(&eval(r#"=FINDB("","東京都",3)"#)), 3.0);
    }

    #[test]
    fn start_out_of_range() {
        assert_eq!(e(&eval(r#"=FINDB("a","東",0)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=FINDB("a","東",3)"#)), CalcError::Value);
    }

    #[test]
    fn wildcards_are_literal() {
        assert_eq!(n(&eval(r#"=FINDB("?","a?b")"#)), 2.0);
    }

    #[test]
    fn numbers_coerce() {
        assert_eq!(n(&eval("=FINDB(3,12345)")), 3.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=FINDB(1/0,"abc")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=FINDB("a",1/0)"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=FINDB("a","abc",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=FINDB("a")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=FINDB("a","b",1,2)"#)), CalcError::Value);
    }
}
