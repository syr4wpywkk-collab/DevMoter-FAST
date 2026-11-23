//! `TRIM(text)` — removes leading and trailing spaces and collapses
//! internal runs of spaces to single spaces.
//! Spec: `docs/functions/TRIM.md`.
//!
//! Only ASCII `U+0020` is trimmed/collapsed (Excel behavior); tabs,
//! newlines, `U+00A0` and `U+3000` are preserved.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match coercion::eval_text(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(s) => Ok(Value::Text(trim_spaces(&s))),
    }
}

/// Excel `TRIM`: strip and collapse U+0020 runs only.
fn trim_spaces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_run = false;
    let mut seen_nonspace = false;
    for c in s.chars() {
        if c == ' ' {
            in_run = true;
        } else {
            if in_run && seen_nonspace {
                out.push(' ');
            }
            in_run = false;
            seen_nonspace = true;
            out.push(c);
        }
    }
    out
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
    fn strips_and_collapses() {
        assert_eq!(t(&eval(r#"=TRIM("  a  b  ")"#)), "a b");
    }

    #[test]
    fn empty_and_space_only() {
        assert_eq!(t(&eval(r#"=TRIM("")"#)), "");
        assert_eq!(t(&eval(r#"=TRIM("   ")"#)), "");
    }

    #[test]
    fn internal_single_space_kept() {
        assert_eq!(t(&eval(r#"=TRIM("a b")"#)), "a b");
    }

    #[test]
    fn tabs_are_not_trimmed() {
        assert_eq!(t(&eval("=TRIM(\" a \t b \")")), "a \t b");
    }

    #[test]
    fn nbsp_is_not_trimmed() {
        assert_eq!(t(&eval("=TRIM(\"\u{a0}a\u{a0}\")")), "\u{a0}a\u{a0}");
    }

    #[test]
    fn ideographic_space_is_not_trimmed() {
        assert_eq!(
            t(&eval("=TRIM(\"\u{3000}a\u{3000}\")")),
            "\u{3000}a\u{3000}"
        );
    }

    #[test]
    fn number_coerces() {
        assert_eq!(t(&eval("=TRIM(12.5)")), "12.5");
    }

    #[test]
    fn blank_ref_is_empty() {
        assert_eq!(t(&eval("=TRIM(A1)")), "");
    }

    #[test]
    fn mixed_runs() {
        assert_eq!(t(&eval(r#"=TRIM("  x   y z   ")"#)), "x y z");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=TRIM(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=TRIM()")), CalcError::Value);
    }
}
