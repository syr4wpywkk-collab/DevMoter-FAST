//! `CHAR(number)` — returns the character for a numeric code in
//! `1..=255`. Spec: `docs/functions/CHAR.md`.
//!
//! Codepage (SPEC-OPEN in the spec doc): the engine fixes the mapping
//! to ASCII for `1..=127` and **Windows-1252** for `128..=255`. The
//! five CP1252 positions with no assigned glyph (`129`, `141`, `143`,
//! `144`, `157`) yield the corresponding C1 control character.
//! `UNICHAR` is preferred for codepoint-based, locale-independent
//! results.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Windows-1252 glyphs for codes `128..=255`; `None` = unassigned
/// position (mapped to the C1 control character).
pub(crate) const CP1252_HIGH: [Option<char>; 128] = [
    Some('€'),
    None,
    Some('‚'),
    Some('ƒ'),
    Some('„'),
    Some('…'),
    Some('†'),
    Some('‡'),
    Some('ˆ'),
    Some('‰'),
    Some('Š'),
    Some('‹'),
    Some('Œ'),
    None,
    Some('Ž'),
    None,
    None,
    Some('‘'),
    Some('’'),
    Some('“'),
    Some('”'),
    Some('•'),
    Some('–'),
    Some('—'),
    Some('˜'),
    Some('™'),
    Some('š'),
    Some('›'),
    Some('œ'),
    None,
    Some('ž'),
    Some('Ÿ'),
    Some('\u{A0}'),
    Some('¡'),
    Some('¢'),
    Some('£'),
    Some('¤'),
    Some('¥'),
    Some('¦'),
    Some('§'),
    Some('¨'),
    Some('©'),
    Some('ª'),
    Some('«'),
    Some('¬'),
    Some('\u{AD}'),
    Some('®'),
    Some('¯'),
    Some('°'),
    Some('±'),
    Some('²'),
    Some('³'),
    Some('´'),
    Some('µ'),
    Some('¶'),
    Some('·'),
    Some('¸'),
    Some('¹'),
    Some('º'),
    Some('»'),
    Some('¼'),
    Some('½'),
    Some('¾'),
    Some('¿'),
    Some('À'),
    Some('Á'),
    Some('Â'),
    Some('Ã'),
    Some('Ä'),
    Some('Å'),
    Some('Æ'),
    Some('Ç'),
    Some('È'),
    Some('É'),
    Some('Ê'),
    Some('Ë'),
    Some('Ì'),
    Some('Í'),
    Some('Î'),
    Some('Ï'),
    Some('Ð'),
    Some('Ñ'),
    Some('Ò'),
    Some('Ó'),
    Some('Ô'),
    Some('Õ'),
    Some('Ö'),
    Some('×'),
    Some('Ø'),
    Some('Ù'),
    Some('Ú'),
    Some('Û'),
    Some('Ü'),
    Some('Ý'),
    Some('Þ'),
    Some('ß'),
    Some('à'),
    Some('á'),
    Some('â'),
    Some('ã'),
    Some('ä'),
    Some('å'),
    Some('æ'),
    Some('ç'),
    Some('è'),
    Some('é'),
    Some('ê'),
    Some('ë'),
    Some('ì'),
    Some('í'),
    Some('î'),
    Some('ï'),
    Some('ð'),
    Some('ñ'),
    Some('ò'),
    Some('ó'),
    Some('ô'),
    Some('õ'),
    Some('ö'),
    Some('÷'),
    Some('ø'),
    Some('ù'),
    Some('ú'),
    Some('û'),
    Some('ü'),
    Some('ý'),
    Some('þ'),
    Some('ÿ'),
];

/// Map a code in `128..=255` to its character under the fixed
/// codepage; unassigned positions return the C1 control character.
pub(crate) fn cp1252_char(code: u8) -> char {
    debug_assert!(code >= 128);
    CP1252_HIGH[(code - 128) as usize].unwrap_or_else(|| char::from_u32(code as u32).unwrap())
}

/// Inverse lookup of [`cp1252_char`] for `CODE`: the code under which
/// `c` is produced by `CHAR`, if any.
pub(crate) fn cp1252_code(c: char) -> Option<u8> {
    CP1252_HIGH
        .iter()
        .position(|g| *g == Some(c))
        .map(|i| i as u8 + 128)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let n = match coercion::eval_number(ctx, &args[0])? {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if !n.is_finite() {
        return Ok(Value::Error(CalcError::Value));
    }
    let code = n.trunc();
    if !(1.0..=255.0).contains(&code) {
        return Ok(Value::Error(CalcError::Value));
    }
    let code = code as u8;
    let c = if code < 128 {
        code as char
    } else {
        cp1252_char(code)
    };
    Ok(Value::Text(c.to_string()))
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
        assert_eq!(t(&eval("=CHAR(65)")), "A");
    }

    #[test]
    fn control_codes() {
        assert_eq!(t(&eval("=CHAR(10)")), "\n");
        assert_eq!(t(&eval("=CHAR(9)")), "\t");
        assert_eq!(t(&eval("=CHAR(13)")), "\r");
    }

    #[test]
    fn cp1252_high() {
        assert_eq!(t(&eval("=CHAR(233)")), "é");
        assert_eq!(t(&eval("=CHAR(128)")), "€");
        assert_eq!(t(&eval("=CHAR(150)")), "–");
    }

    #[test]
    fn unassigned_cp1252_is_c1_control() {
        assert_eq!(t(&eval("=CHAR(129)")), "\u{81}");
    }

    #[test]
    fn zero_and_256_are_value_errors() {
        assert_eq!(e(&eval("=CHAR(0)")), CalcError::Value);
        assert_eq!(e(&eval("=CHAR(256)")), CalcError::Value);
    }

    #[test]
    fn negative_is_value_error() {
        assert_eq!(e(&eval("=CHAR(-1)")), CalcError::Value);
    }

    #[test]
    fn truncates_toward_zero() {
        assert_eq!(t(&eval("=CHAR(65.9)")), "A");
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(t(&eval(r#"=CHAR("66")"#)), "B");
    }

    #[test]
    fn nonnumeric_is_value_error() {
        assert_eq!(e(&eval(r#"=CHAR("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=CHAR(TRUE)")), "\u{1}");
    }

    #[test]
    fn blank_ref_is_value_error() {
        assert_eq!(e(&eval("=CHAR(A1)")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=CHAR(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CHAR()")), CalcError::Value);
        assert_eq!(e(&eval("=CHAR(1,2)")), CalcError::Value);
    }
}
