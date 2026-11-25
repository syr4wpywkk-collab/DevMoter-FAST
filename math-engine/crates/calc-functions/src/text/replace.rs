//! `REPLACE(old_text, start_num, num_chars, new_text)` — replaces
//! `num_chars` characters starting at 1-based `start_num` with
//! `new_text`. Spec: `docs/functions/REPLACE.md`.
//!
//! Position-based (UTF-16 code units via
//! [`crate::common::text_index`]). `start_num` < 1 or `num_chars` < 0
//! is `#VALUE!`; `start_num` past the end appends; `start_num` +
//! `num_chars` past the end truncates there. Fractional positions and
//! counts are truncated toward zero.

use crate::common::{coercion, text_index};
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
    let units = count.trunc().min(usize::MAX as f64) as usize;
    let head = text_index::mid_units(&old, 0, start0);
    let tail = text_index::mid_units(&old, start0.saturating_add(units), usize::MAX);
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
    fn basic() {
        assert_eq!(t(&eval(r#"=REPLACE("abcdef",2,3,"X")"#)), "aXef");
        assert_eq!(t(&eval(r#"=REPLACE("2009",3,2,"10")"#)), "2010");
    }

    #[test]
    fn zero_count_inserts() {
        assert_eq!(t(&eval(r#"=REPLACE("abcd",2,0,"X")"#)), "aXbcd");
    }

    #[test]
    fn start_past_end_appends() {
        assert_eq!(t(&eval(r#"=REPLACE("abc",4,1,"d")"#)), "abcd");
        assert_eq!(t(&eval(r#"=REPLACE("abc",99,1,"d")"#)), "abcd");
    }

    #[test]
    fn removes_to_end() {
        assert_eq!(t(&eval(r#"=REPLACE("abcdef",4,99,"")"#)), "abc");
    }

    #[test]
    fn start_below_one_is_value_error() {
        assert_eq!(e(&eval(r#"=REPLACE("abc",0,1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn negative_count_is_value_error() {
        assert_eq!(e(&eval(r#"=REPLACE("abc",1,-1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn fractional_args_truncate() {
        assert_eq!(t(&eval(r#"=REPLACE("abcd",2.9,1.9,"X")"#)), "aXcd");
    }

    #[test]
    fn empty_new_deletes() {
        assert_eq!(t(&eval(r#"=REPLACE("abcdef",2,3,"")"#)), "aef");
    }

    #[test]
    fn numbers_coerce() {
        assert_eq!(t(&eval("=REPLACE(2009,3,2,10)")), "2010");
    }

    #[test]
    fn non_bmp_counts_units() {
        assert_eq!(t(&eval(r#"=REPLACE("a😀b",2,2,"X")"#)), "aXb");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=REPLACE(1/0,1,1,"x")"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=REPLACE("a",1,1)"#)), CalcError::Value);
    }
}
