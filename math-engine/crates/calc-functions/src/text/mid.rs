//! `MID(text, start_num, num_chars)` — returns `num_chars` characters
//! starting at 1-based position `start_num`.
//! Spec: `docs/functions/MID.md`.
//!
//! Positions and lengths count UTF-16 code units
//! ([`crate::common::text_index`]). `start_num` < 1 or
//! `num_chars` < 0 is `#VALUE!`; the slice clamps at the end.

use crate::common::{coercion, text_index};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let text = match coercion::eval_text(ctx, &args[0])? {
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
    if !start.is_finite() || !count.is_finite() || start < 1.0 || count < 0.0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let start0 = (start.trunc() - 1.0).min(usize::MAX as f64) as usize;
    let units = count.trunc().min(usize::MAX as f64) as usize;
    Ok(Value::Text(
        text_index::mid_units(&text, start0, units).to_string(),
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
    fn basic() {
        assert_eq!(t(&eval(r#"=MID("abcdef",2,3)"#)), "bcd");
    }

    #[test]
    fn start_past_end_is_empty() {
        assert_eq!(t(&eval(r#"=MID("abc",9,2)"#)), "");
    }

    #[test]
    fn start_below_one_is_value_error() {
        assert_eq!(e(&eval(r#"=MID("abc",0,1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=MID("abc",-2,1)"#)), CalcError::Value);
    }

    #[test]
    fn negative_num_chars_is_value_error() {
        assert_eq!(e(&eval(r#"=MID("abc",1,-1)"#)), CalcError::Value);
    }

    #[test]
    fn zero_num_chars_is_empty() {
        assert_eq!(t(&eval(r#"=MID("abc",1,0)"#)), "");
    }

    #[test]
    fn clamps_at_end() {
        assert_eq!(t(&eval(r#"=MID("abc",2,99)"#)), "bc");
    }

    #[test]
    fn fractional_args_truncate() {
        assert_eq!(t(&eval(r#"=MID("abc",1.9,1.9)"#)), "a");
    }

    #[test]
    fn number_coerces_to_text() {
        assert_eq!(t(&eval("=MID(12345,2,2)")), "23");
    }

    #[test]
    fn blank_ref_is_empty() {
        assert_eq!(t(&eval("=MID(A1,1,3)")), "");
    }

    #[test]
    fn nonnumeric_arg_is_value_error() {
        assert_eq!(e(&eval(r#"=MID("abc","x",1)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MID(1/0,1,1)")), CalcError::DivZero);
    }

    #[test]
    fn non_bmp_counts_utf16_units() {
        assert_eq!(t(&eval(r#"=MID("a😀b",2,2)"#)), "😀");
        assert_eq!(t(&eval(r#"=MID("a😀b",4,1)"#)), "b");
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=MID("a",1)"#)), CalcError::Value);
    }
}
