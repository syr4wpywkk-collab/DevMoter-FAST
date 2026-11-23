//! `MIDB(text, start_num, num_bytes)` — byte-oriented variant of
//! `MID`: extracts `num_bytes` bytes starting at 1-based byte
//! position `start_num`. Spec: `docs/functions/MIDB.md`.
//!
//! Positions count DBCS bytes via [`crate::common::dbcs`]. A
//! `start_num` inside a double-byte character snaps forward to the
//! next character boundary, and a trailing partial character is
//! dropped (SPEC-OPEN boundary notes in the spec doc). `start_num`
//! < 1 or `num_bytes` < 0 is `#VALUE!`; the slice clamps at the end.

use crate::common::{coercion, dbcs};
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
    let bytes = count.trunc().min(usize::MAX as f64) as usize;
    Ok(Value::Text(
        dbcs::mid_bytes(&text, start0, bytes).to_string(),
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
    fn ascii_basic() {
        assert_eq!(t(&eval(r#"=MIDB("abcdef",2,3)"#)), "bcd");
    }

    #[test]
    fn double_byte_positions() {
        assert_eq!(t(&eval(r#"=MIDB("東京都",3,2)"#)), "京");
        assert_eq!(t(&eval(r#"=MIDB("東京都",1,4)"#)), "東京");
    }

    #[test]
    fn start_inside_char_snaps_forward() {
        assert_eq!(t(&eval(r#"=MIDB("東京都",2,2)"#)), "京");
    }

    #[test]
    fn end_partial_char_dropped() {
        assert_eq!(t(&eval(r#"=MIDB("東京都",1,3)"#)), "東");
    }

    #[test]
    fn start_past_end_is_empty() {
        assert_eq!(t(&eval(r#"=MIDB("abc",4,1)"#)), "");
        assert_eq!(t(&eval(r#"=MIDB("東",3,1)"#)), "");
    }

    #[test]
    fn count_clamps_at_end() {
        assert_eq!(t(&eval(r#"=MIDB("abc",2,99)"#)), "bc");
    }

    #[test]
    fn zero_count_is_empty() {
        assert_eq!(t(&eval(r#"=MIDB("abc",1,0)"#)), "");
    }

    #[test]
    fn fractional_args_truncate() {
        assert_eq!(t(&eval(r#"=MIDB("abcdef",2.9,2.9)"#)), "bc");
    }

    #[test]
    fn start_below_one_is_value_error() {
        assert_eq!(e(&eval(r#"=MIDB("abc",0,1)"#)), CalcError::Value);
    }

    #[test]
    fn negative_count_is_value_error() {
        assert_eq!(e(&eval(r#"=MIDB("abc",1,-1)"#)), CalcError::Value);
    }

    #[test]
    fn number_coerces() {
        assert_eq!(t(&eval("=MIDB(12345,2,2)")), "23");
    }

    #[test]
    fn mixed_width() {
        assert_eq!(t(&eval(r#"=MIDB("a東b",2,2)"#)), "東");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MIDB(1/0,1,1)")), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=MIDB("x",1/0,1)"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=MIDB("x",1,1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=MIDB("a",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=MIDB("a",1,1,1)"#)), CalcError::Value);
    }
}
