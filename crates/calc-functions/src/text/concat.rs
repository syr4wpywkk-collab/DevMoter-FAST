//! `CONCAT(text1, [text2], ...)` — joins arguments into one text value.
//! Spec: `docs/functions/CONCAT.md`.
//!
//! Unlike the legacy `CONCATENATE`, range arguments are flattened in
//! row-major order. Blank cells contribute `""`; errors propagate;
//! there is no output-length cap yet (SPEC-OPEN in the spec doc —
//! Excel truncates cell text at 32,767 chars).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let mut out = String::new();
    for (v, _) in coercion::flatten_args(ctx, args)? {
        if let Err(e) = push_value(&v, &mut out) {
            return Ok(Value::Error(e));
        }
    }
    Ok(Value::Text(out))
}

/// Append `v`'s text form to `out`; arrays flatten recursively in
/// row-major order. Returns the first error encountered.
fn push_value(v: &Value, out: &mut String) -> Result<(), CalcError> {
    match v {
        Value::Array(a) => {
            for cell in a.iter() {
                push_value(cell, out)?;
            }
            Ok(())
        }
        _ => match v.to_text() {
            Ok(s) => {
                out.push_str(&s);
                Ok(())
            }
            Err(e) => Err(e),
        },
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
    fn joins_scalars() {
        assert_eq!(t(&eval(r#"=CONCAT("a","b","c")"#)), "abc");
    }

    #[test]
    fn single_arg() {
        assert_eq!(t(&eval(r#"=CONCAT("only")"#)), "only");
    }

    #[test]
    fn numbers_and_booleans_coerce() {
        assert_eq!(t(&eval(r#"=CONCAT(1,2.5,TRUE)"#)), "12.5TRUE");
    }

    #[test]
    fn empty_string_args_allowed() {
        assert_eq!(t(&eval(r#"=CONCAT("a","","b")"#)), "ab");
    }

    #[test]
    fn range_flattens_row_major() {
        let v = eval_with(
            &[
                ("A1", "a".into()),
                ("B1", "b".into()),
                ("A2", "c".into()),
                ("B2", "d".into()),
            ],
            "=CONCAT(A1:B2)",
        );
        assert_eq!(t(&v), "abcd");
    }

    #[test]
    fn range_skips_blanks() {
        let v = eval_with(&[("A1", "a".into()), ("A3", "c".into())], "=CONCAT(A1:A3)");
        assert_eq!(t(&v), "ac");
    }

    #[test]
    fn range_numbers_coerce() {
        let v = eval_with(&[("A1", 1.0.into()), ("A2", 2.0.into())], "=CONCAT(A1:A2)");
        assert_eq!(t(&v), "12");
    }

    #[test]
    fn mixed_range_and_scalar() {
        let v = eval_with(
            &[("A1", "x".into()), ("A2", "y".into())],
            r#"=CONCAT(A1:A2,"z")"#,
        );
        assert_eq!(t(&v), "xyz");
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", "x".into())],
            "=CONCAT(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval(r#"=CONCAT("a",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CONCAT()")), CalcError::Value);
    }
}
