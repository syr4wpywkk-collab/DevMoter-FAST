//! `VALUE(text)` — parses a text string into a number.
//! Spec: `docs/functions/VALUE.md`.
//!
//! Fixed en-US-locale parsing: surrounding whitespace ignored, optional
//! sign, `.` decimal point, `,` thousands separators only in valid
//! 3-digit grouping positions, `E`/`e` exponent, trailing `%` dividing
//! by 100. Unparseable text (including `"1,2,3"`, `"--3"`, `""`) is
//! `#VALUE!`. Date/time and currency strings are outside the subset
//! (spec doc open questions) and error.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval(&args[0])?;
    let result = match &v {
        Value::Text(s) => parse_value_text(s).ok_or(CalcError::Value),
        // `VALUE` of an empty/blank input is `#VALUE!` like `VALUE("")`.
        Value::Blank => Err(CalcError::Value),
        _ => v.to_number(),
    };
    match result {
        Ok(n) => Ok(Value::Number(n)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Fixed-locale (en-US) numeric text parser per the spec subset.
fn parse_value_text(s: &str) -> Option<f64> {
    let mut t = s.trim();
    if t.is_empty() {
        return None;
    }
    let mut scale = 1.0;
    if let Some(rest) = t.strip_suffix('%') {
        t = rest.trim_end();
        scale = 0.01;
    }
    // Split off an exponent: at most one 'e'/'E', after which an
    // optional sign and a non-empty digit run are required.
    let is_exp = |c: char| c == 'e' || c == 'E';
    let exp_index = t.find(is_exp);
    let (mantissa, exp) = match exp_index {
        Some(i) => {
            let exp = &t[i + 1..];
            let digits = exp.strip_prefix(|c| c == '+' || c == '-').unwrap_or(exp);
            if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            (&t[..i], Some(exp))
        }
        None => (t, None),
    };
    let m = mantissa
        .strip_prefix(|c| c == '+' || c == '-')
        .unwrap_or(mantissa);
    if m.is_empty() {
        return None;
    }
    let (int, frac) = match m.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (m, None),
    };
    // Validate `,` grouping in the integer part: first group 1-3
    // digits, every later group exactly 3.
    let mut int_digits = String::new();
    if int.contains(',') {
        let mut groups = int.split(',');
        let first = groups.next().unwrap();
        if first.is_empty() || first.len() > 3 || !first.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        int_digits.push_str(first);
        for g in groups {
            if g.len() != 3 || !g.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            int_digits.push_str(g);
        }
    } else if int.bytes().all(|b| b.is_ascii_digit()) {
        int_digits.push_str(int);
    } else {
        return None;
    }
    let frac_digits = frac.unwrap_or("");
    if !frac_digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if int_digits.is_empty() && frac_digits.is_empty() {
        return None;
    }
    // Rebuild without commas: sign + int_digits + optional fraction.
    let mut canonical = String::new();
    if mantissa.starts_with('-') {
        canonical.push('-');
    }
    canonical.push_str(if int_digits.is_empty() {
        "0"
    } else {
        &int_digits
    });
    if frac.is_some() {
        canonical.push('.');
        canonical.push_str(frac_digits);
    }
    if let Some(exp) = exp {
        canonical.push('e');
        canonical.push_str(exp);
    }
    canonical
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
        .map(|n| n * scale)
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
    fn integer_and_decimal() {
        assert_eq!(n(&eval(r#"=VALUE("123")"#)), 123.0);
        assert_eq!(n(&eval(r#"=VALUE("1.5")"#)), 1.5);
    }

    #[test]
    fn whitespace_and_sign() {
        assert_eq!(n(&eval(r#"=VALUE("  -42 ")"#)), -42.0);
        assert_eq!(n(&eval(r#"=VALUE("+7")"#)), 7.0);
    }

    #[test]
    fn thousands_grouping() {
        assert_eq!(n(&eval(r#"=VALUE(" 1,234.50 ")"#)), 1234.5);
        assert_eq!(n(&eval(r#"=VALUE("1,234,567")"#)), 1234567.0);
    }

    #[test]
    fn bad_grouping_is_value_error() {
        assert_eq!(e(&eval(r#"=VALUE("1,2,3")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUE("12,34")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUE(",123")"#)), CalcError::Value);
    }

    #[test]
    fn exponent() {
        assert_eq!(n(&eval(r#"=VALUE("1e3")"#)), 1000.0);
        assert_eq!(n(&eval(r#"=VALUE("1.5E-2")"#)), 0.015);
    }

    #[test]
    fn trailing_percent() {
        assert_eq!(n(&eval(r#"=VALUE("5%")"#)), 0.05);
    }

    #[test]
    fn unparseable_is_value_error() {
        assert_eq!(e(&eval(r#"=VALUE("abc")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUE("--3")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUE("")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=VALUE("1.2.3")"#)), CalcError::Value);
    }

    #[test]
    fn number_passthrough_and_boolean() {
        assert_eq!(n(&eval("=VALUE(3.5)")), 3.5);
        assert_eq!(n(&eval("=VALUE(TRUE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_value_error() {
        assert_eq!(e(&eval("=VALUE(A1)")), CalcError::Value);
    }

    #[test]
    fn text_ref_parses() {
        assert_eq!(n(&eval_with(&[("A1", "12.5".into())], "=VALUE(A1)")), 12.5);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=VALUE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=VALUE()")), CalcError::Value);
    }
}
