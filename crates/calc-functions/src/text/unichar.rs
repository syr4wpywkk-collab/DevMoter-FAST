//! `UNICHAR(number)` — the Unicode character for a codepoint.
//! Spec: `docs/functions/UNICHAR.md`.
//!
//! `number` truncates toward zero; the valid range is `1..=0x10FFFF`.
//! `0`, negatives, out-of-range values and the UTF-16 surrogate range
//! `0xD800..=0xDFFF` are `#VALUE!` (a `char` cannot hold a lone
//! surrogate — `char::from_u32` rejects them, matching Excel). Excel's
//! treatment of noncharacters (`0xFFFE`, `0xFFFF`, ...) is an open
//! question in the spec doc; they are returned as-is here.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let n = match coercion::eval_number(ctx, &args[0])? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if !n.is_finite() || n < 1.0 || n > 0x10FFFF as f64 {
        return Ok(Value::Error(CalcError::Value));
    }
    match char::from_u32(n.trunc() as u32) {
        Some(c) => Ok(Value::Text(c.to_string())),
        None => Ok(Value::Error(CalcError::Value)),
    }
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
    fn ascii() {
        assert_eq!(t(&eval("=UNICHAR(65)")), "A");
    }

    #[test]
    fn bmp_nonascii() {
        assert_eq!(t(&eval("=UNICHAR(960)")), "π");
        assert_eq!(t(&eval("=UNICHAR(26481)")), "東");
    }

    #[test]
    fn supplementary_plane() {
        assert_eq!(t(&eval("=UNICHAR(128512)")), "😀");
    }

    #[test]
    fn control_char() {
        assert_eq!(t(&eval("=UNICHAR(10)")), "\n");
    }

    #[test]
    fn fractional_truncates() {
        assert_eq!(t(&eval("=UNICHAR(65.9)")), "A");
    }

    #[test]
    fn zero_is_error() {
        assert_eq!(e(&eval("=UNICHAR(0)")), CalcError::Value);
        assert_eq!(e(&eval("=UNICHAR(0.5)")), CalcError::Value);
    }

    #[test]
    fn negative_is_error() {
        assert_eq!(e(&eval("=UNICHAR(-1)")), CalcError::Value);
    }

    #[test]
    fn surrogate_range_is_error() {
        assert_eq!(e(&eval("=UNICHAR(55296)")), CalcError::Value);
        assert_eq!(e(&eval("=UNICHAR(57343)")), CalcError::Value);
    }

    #[test]
    fn out_of_range_is_error() {
        assert_eq!(e(&eval("=UNICHAR(1114112)")), CalcError::Value);
        assert_eq!(e(&eval("=UNICHAR(1E+20)")), CalcError::Value);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(t(&eval(r#"=UNICHAR("66")"#)), "B");
        assert_eq!(e(&eval(r#"=UNICHAR("x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=UNICHAR(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=UNICHAR()")), CalcError::Value);
        assert_eq!(e(&eval("=UNICHAR(65,66)")), CalcError::Value);
    }
}
