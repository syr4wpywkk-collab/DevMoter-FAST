//! `CONCATENATE(text1, [text2], ...)` — legacy join of scalar
//! arguments into one text value. Spec: `docs/functions/CONCATENATE.md`.
//!
//! Unlike `CONCAT`, range arguments are NOT flattened: scalar text
//! coercion makes a multi-cell range `#VALUE!` (the spec doc marks
//! legacy implicit-intersection behavior SPEC-OPEN). Blank cells
//! contribute `""`; errors propagate; no output-length cap (same
//! SPEC-OPEN as `CONCAT`).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let mut out = String::new();
    for arg in args {
        match coercion::eval_text(ctx, arg)? {
            Ok(s) => out.push_str(&s),
            Err(e) => return Ok(Value::Error(e)),
        }
    }
    Ok(Value::Text(out))
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
        assert_eq!(t(&eval(r#"=CONCATENATE("a","b","c")"#)), "abc");
    }

    #[test]
    fn single_arg() {
        assert_eq!(t(&eval(r#"=CONCATENATE("only")"#)), "only");
    }

    #[test]
    fn number_coerces() {
        assert_eq!(t(&eval(r#"=CONCATENATE("Total: ",1+2)"#)), "Total: 3");
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(t(&eval(r#"=CONCATENATE("x",TRUE)"#)), "xTRUE");
    }

    #[test]
    fn empty_strings() {
        assert_eq!(t(&eval(r#"=CONCATENATE("","")"#)), "");
    }

    #[test]
    fn blank_cell_is_empty() {
        let v = eval_with(&[("A2", "b".into())], r#"=CONCATENATE(A1,A2)"#);
        assert_eq!(t(&v), "b");
    }

    #[test]
    fn cell_refs_join() {
        let v = eval_with(
            &[("A1", "he".into()), ("A2", "llo".into())],
            "=CONCATENATE(A1,A2)",
        );
        assert_eq!(t(&v), "hello");
    }

    #[test]
    fn multi_cell_range_is_value_error() {
        let v = eval_with(
            &[("A1", "a".into()), ("A2", "b".into())],
            "=CONCATENATE(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=CONCATENATE("a",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            r#"=CONCATENATE("x",A1)"#,
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CONCATENATE()")), CalcError::Value);
    }
}
