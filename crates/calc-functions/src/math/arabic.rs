//! `ARABIC(text)` — converts a Roman numeral string to an Arabic
//! integer in `-3999..=3999`. Spec: `docs/functions/ARABIC.md`.
//!
//! Case-insensitive; leading/trailing spaces and a single leading `+`
//! or `-` sign are accepted. Subtractive notation (`IV`, `IX`, `XL`,
//! `XC`, `CD`, `CM`) is handled by the standard
//! smaller-before-larger subtraction rule; non-canonical strings are
//! evaluated additively under that same rule (SPEC-OPEN — Excel's
//! exact grammar tolerance is unconfirmed). Empty input -> `#VALUE!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

fn digit(c: u8) -> Option<i64> {
    Some(match c {
        b'I' => 1,
        b'V' => 5,
        b'X' => 10,
        b'L' => 50,
        b'C' => 100,
        b'D' => 500,
        b'M' => 1000,
        _ => return None,
    })
}

fn roman_value(s: &str) -> Option<i64> {
    let s = s.trim();
    let (sign, s) = match s.as_bytes().first() {
        Some(b'-') => (-1i64, &s[1..]),
        Some(b'+') => (1, &s[1..]),
        _ => (1, s),
    };
    if s.is_empty() {
        return None;
    }
    let mut digits = Vec::with_capacity(s.len());
    for c in s.bytes() {
        digits.push(digit(c.to_ascii_uppercase())?);
    }
    let mut total = 0i64;
    for (i, &d) in digits.iter().enumerate() {
        if digits.get(i + 1).is_some_and(|&next| next > d) {
            total -= d;
        } else {
            total += d;
        }
    }
    let v = sign * total;
    if !(-3999..=3999).contains(&v) {
        return None;
    }
    Some(v)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval(&args[0])?;
    if let Some(e) = v.error() {
        return Ok(Value::Error(e));
    }
    let text = match v.to_text() {
        Ok(t) => t,
        Err(e) => return Ok(Value::Error(e)),
    };
    match roman_value(&text) {
        Some(n) => Ok(Value::Number(n as f64)),
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
    fn spec_examples() {
        assert_eq!(n(&eval(r#"=ARABIC("LVII")"#)), 57.0);
        assert_eq!(n(&eval(r#"=ARABIC("MCMXII")"#)), 1912.0);
        assert_eq!(n(&eval(r#"=ARABIC("-XIV")"#)), -14.0);
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(n(&eval(r#"=ARABIC("mcmxii")"#)), 1912.0);
    }

    #[test]
    fn subtractive_pairs() {
        assert_eq!(n(&eval(r#"=ARABIC("IV")"#)), 4.0);
        assert_eq!(n(&eval(r#"=ARABIC("IX")"#)), 9.0);
        assert_eq!(n(&eval(r#"=ARABIC("XL")"#)), 40.0);
        assert_eq!(n(&eval(r#"=ARABIC("XC")"#)), 90.0);
        assert_eq!(n(&eval(r#"=ARABIC("CD")"#)), 400.0);
        assert_eq!(n(&eval(r#"=ARABIC("CM")"#)), 900.0);
    }

    #[test]
    fn surrounding_spaces_and_plus_sign() {
        assert_eq!(n(&eval(r#"=ARABIC("  XIV ")"#)), 14.0);
        assert_eq!(n(&eval(r#"=ARABIC("+XIV")"#)), 14.0);
    }

    #[test]
    fn bounds() {
        assert_eq!(n(&eval(r#"=ARABIC("MMMCMXCIX")"#)), 3999.0);
        assert_eq!(e(&eval(r#"=ARABIC("MMMM")"#)), CalcError::Value);
        assert_eq!(n(&eval(r#"=ARABIC("-MMMCMXCIX")"#)), -3999.0);
    }

    #[test]
    fn invalid_characters() {
        assert_eq!(e(&eval(r#"=ARABIC("ABC")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=ARABIC("XYZ")"#)), CalcError::Value);
    }

    #[test]
    fn empty_string_value_error() {
        // SPEC-OPEN: `#VALUE!` chosen over `0` per spec discussion.
        assert_eq!(e(&eval(r#"=ARABIC("")"#)), CalcError::Value);
    }

    #[test]
    fn numeric_input_value_error() {
        // Numbers coerce to text like "5", which is not a numeral.
        assert_eq!(e(&eval("=ARABIC(5)")), CalcError::Value);
    }

    #[test]
    fn boolean_input_value_error() {
        assert_eq!(e(&eval("=ARABIC(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_value_error() {
        assert_eq!(e(&eval("=ARABIC(A1)")), CalcError::Value);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", "XIV".into())], "=ARABIC(A1)");
        assert_eq!(n(&v), 14.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ARABIC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=ARABIC("X","I")"#)), CalcError::Value);
    }
}
