//! `PROPER(text)` — capitalizes the first letter of each word and
//! lowercases the rest. Spec: `docs/functions/PROPER.md`.
//!
//! A word boundary is any non-letter character (digits, punctuation,
//! spaces and apostrophes all separate), matching Excel's
//! `PROPER("it's")` -> `"It'S"`. Letter detection is Unicode
//! (`char::is_alphabetic`); the exact Unicode boundary set is a spec
//! doc open question recorded in fixtures.

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
        Ok(s) => Ok(Value::Text(proper(&s))),
    }
}

fn proper(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut word_start = true;
    for c in s.chars() {
        if c.is_alphabetic() {
            if word_start {
                out.push(super::upper_char(c));
            } else {
                out.push(super::lower_char(c));
            }
            word_start = false;
        } else {
            word_start = true;
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
    fn basic() {
        assert_eq!(t(&eval(r#"=PROPER("hello world")"#)), "Hello World");
    }

    #[test]
    fn lowercases_rest_of_word() {
        assert_eq!(t(&eval(r#"=PROPER("hELLO wORLD")"#)), "Hello World");
    }

    #[test]
    fn digits_separate_words() {
        assert_eq!(t(&eval(r#"=PROPER("2-way street")"#)), "2-Way Street");
        assert_eq!(t(&eval(r#"=PROPER("76BudGet")"#)), "76Budget");
    }

    #[test]
    fn apostrophe_is_separator() {
        // Excel behavior: the letter after an apostrophe capitalizes.
        assert_eq!(t(&eval(r#"=PROPER("it's")"#)), "It'S");
    }

    #[test]
    fn punctuation_separators() {
        assert_eq!(
            t(&eval(r#"=PROPER("tom's-harvest (fine)")"#)),
            "Tom'S-Harvest (Fine)"
        );
    }

    #[test]
    fn empty() {
        assert_eq!(t(&eval(r#"=PROPER("")"#)), "");
    }

    #[test]
    fn unicode_letters() {
        assert_eq!(t(&eval(r#"=PROPER("café noir")"#)), "Café Noir");
    }

    #[test]
    fn number_coerces() {
        assert_eq!(t(&eval("=PROPER(123)")), "123");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval("=PROPER(TRUE)")), "True");
    }

    #[test]
    fn blank_ref_is_empty() {
        assert_eq!(t(&eval("=PROPER(A1)")), "");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=PROPER(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=PROPER()")), CalcError::Value);
    }
}
