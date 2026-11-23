//! `NUMBERVALUE(text, [decimal_separator], [group_separator])` —
//! parses text into a number with explicit separators, the
//! locale-independent counterpart to `VALUE`.
//! Spec: `docs/functions/NUMBERVALUE.md`.
//!
//! Defaults are the fixed-locale separators `"."` and `","`. Group
//! separators are stripped wherever they appear (Excel does not
//! validate grouping positions); at most one decimal separator is
//! allowed. Trailing `%` characters each divide by 100; surrounding
//! whitespace is ignored; empty text yields `0` (SPEC-OPEN in the
//! spec doc). Date/time/currency text is not parsed.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Coerce an optional separator argument to a single char; `default`
/// applies when the argument is absent/`Missing`. Anything else —
/// empty, multi-char, or a digit (SPEC-OPEN) — is `#VALUE!`.
fn separator(
    ctx: &mut EvalContext<'_>,
    arg: Option<&Expr>,
    default: char,
) -> Result<Result<char, CalcError>, EvalError> {
    let s = match arg {
        None | Some(Expr::Missing) => return Ok(Ok(default)),
        Some(e) => match coercion::eval_text(ctx, e)? {
            Err(e) => return Ok(Err(e)),
            Ok(s) => s,
        },
    };
    let mut chars = s.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if !c.is_ascii_digit() => Ok(Ok(c)),
        _ => Ok(Err(CalcError::Value)),
    }
}

/// Parse `text` into a number given the separators.
fn parse(text: &str, dec: char, grp: char) -> Result<f64, CalcError> {
    // When the separators collide (e.g. group separator left at its
    // default while the decimal separator is explicitly ","), the
    // decimal separator wins and no group stripping happens —
    // `NUMBERVALUE("2500,27",",")` must parse as 2500.27.
    let grp = if grp == dec { '\0' } else { grp };
    let t = text.trim();
    if t.is_empty() {
        // SPEC-OPEN: documented as 0 (unlike VALUE's #VALUE!).
        return Ok(0.0);
    }
    let mut pct = 0u32;
    let mut body = t;
    while let Some(rest) = body.strip_suffix('%') {
        pct += 1;
        body = rest;
    }
    let mut out = String::with_capacity(body.len());
    let mut seen_dec = false;
    for c in body.chars() {
        if c == grp {
            continue;
        }
        if c == dec {
            if seen_dec {
                return Err(CalcError::Value);
            }
            seen_dec = true;
            out.push('.');
            continue;
        }
        if !matches!(c, '0'..='9' | '+' | '-' | 'e' | 'E' | '.') {
            return Err(CalcError::Value);
        }
        out.push(c);
    }
    // Strict grammar: [+-]? (digits [.digits?] | .digits) ([eE][+-]?digits)?
    let mut valid = false;
    {
        let mut chars = out.as_str().chars().peekable();
        if matches!(chars.peek(), Some('+' | '-')) {
            chars.next();
        }
        let mut int_digits = 0usize;
        let mut frac_digits = 0usize;
        while matches!(chars.peek(), Some('0'..='9')) {
            chars.next();
            int_digits += 1;
        }
        if chars.peek() == Some(&'.') {
            chars.next();
            while matches!(chars.peek(), Some('0'..='9')) {
                chars.next();
                frac_digits += 1;
            }
        }
        if int_digits + frac_digits > 0 {
            if matches!(chars.peek(), Some('e' | 'E')) {
                chars.next();
                if matches!(chars.peek(), Some('+' | '-')) {
                    chars.next();
                }
                let mut exp_digits = 0usize;
                while matches!(chars.peek(), Some('0'..='9')) {
                    chars.next();
                    exp_digits += 1;
                }
                valid = exp_digits > 0;
            } else {
                valid = true;
            }
        }
        valid = valid && chars.peek().is_none();
    }
    if !valid {
        return Err(CalcError::Value);
    }
    out.parse::<f64>()
        .map(|v| v / 100f64.powi(pct as i32))
        .map_err(|_| CalcError::Value)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 3) {
        return Ok(Value::Error(e));
    }
    let text = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let dec = match separator(ctx, args.get(1), '.')? {
        Ok(c) => c,
        Err(e) => return Ok(Value::Error(e)),
    };
    let grp = match separator(ctx, args.get(2), ',')? {
        Ok(c) => c,
        Err(e) => return Ok(Value::Error(e)),
    };
    match parse(&text, dec, grp) {
        Ok(n) => Ok(Value::Number(n)),
        Err(e) => Ok(Value::Error(e)),
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
    fn european_separators() {
        assert_eq!(n(&eval(r#"=NUMBERVALUE("2.500,27",",",".")"#)), 2500.27);
    }

    #[test]
    fn default_separators() {
        assert_eq!(n(&eval(r#"=NUMBERVALUE("1,234.5")"#)), 1234.5);
    }

    #[test]
    fn percent_divides() {
        assert_eq!(n(&eval(r#"=NUMBERVALUE("9%")"#)), 0.09);
        assert_eq!(n(&eval(r#"=NUMBERVALUE("9%%")"#)), 0.0009);
    }

    #[test]
    fn group_positions_not_validated() {
        assert_eq!(n(&eval(r#"=NUMBERVALUE("1,2,3")"#)), 123.0);
    }

    #[test]
    fn sign_and_exponent() {
        assert_eq!(n(&eval(r#"=NUMBERVALUE("-1.5e2")"#)), -150.0);
        assert_eq!(n(&eval(r#"=NUMBERVALUE("+3")"#)), 3.0);
    }

    #[test]
    fn whitespace_trimmed() {
        assert_eq!(n(&eval(r#"=NUMBERVALUE("  42 ")"#)), 42.0);
    }

    #[test]
    fn empty_text_is_zero() {
        assert_eq!(n(&eval(r#"=NUMBERVALUE("")"#)), 0.0);
    }

    #[test]
    fn unparseable_is_value_error() {
        assert_eq!(e(&eval(r#"=NUMBERVALUE("abc")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=NUMBERVALUE("$1")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=NUMBERVALUE("1/2")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=NUMBERVALUE("2020-01-01")"#)), CalcError::Value);
    }

    #[test]
    fn second_decimal_separator_errors() {
        assert_eq!(e(&eval(r#"=NUMBERVALUE("1.2.3")"#)), CalcError::Value);
    }

    #[test]
    fn separator_args_must_be_single_char() {
        assert_eq!(e(&eval(r#"=NUMBERVALUE("1","..")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=NUMBERVALUE("1","")"#)), CalcError::Value);
    }

    #[test]
    fn equal_separators_decimal_wins() {
        // Colliding separators: decimal wins, group stripping off.
        assert_eq!(n(&eval(r#"=NUMBERVALUE("1,5",",",",")"#)), 1.5);
        assert_eq!(n(&eval(r#"=NUMBERVALUE("2500,27",",")"#)), 2500.27);
    }

    #[test]
    fn number_arg_coerces() {
        assert_eq!(n(&eval("=NUMBERVALUE(1.5)")), 1.5);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=NUMBERVALUE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=NUMBERVALUE()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=NUMBERVALUE("1",".",",",1)"#)), CalcError::Value);
    }
}
