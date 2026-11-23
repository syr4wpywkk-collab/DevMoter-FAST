//! `TRUE()` — returns the logical value TRUE.
//! Spec: `docs/functions/TRUE.md`.
//!
//! The bare word `TRUE` (no parentheses) is already handled by the
//! parser as a `Literal::Bool(true)` — see `parser.rs::classify_word` —
//! so only the call form is implemented here.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(_ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 0, 0) {
        return Ok(Value::Error(e));
    }
    Ok(Value::Boolean(true))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn returns_true() {
        assert_eq!(eval("=TRUE()"), Value::Boolean(true));
    }

    #[test]
    fn bare_literal_alias() {
        assert_eq!(eval("=TRUE"), Value::Boolean(true));
    }

    #[test]
    fn numeric_coercion() {
        let v = eval("=TRUE()+0");
        assert_eq!(v, Value::Number(1.0));
        assert_eq!(eval("=TRUE()*5"), Value::Number(5.0));
    }

    #[test]
    fn text_coercion() {
        assert_eq!(eval(r#"=TRUE()&"""#), Value::Text("TRUE".into()));
    }

    #[test]
    fn not_true_is_false() {
        assert_eq!(eval("=NOT(TRUE())"), Value::Boolean(false));
    }

    #[test]
    fn if_condition() {
        assert_eq!(eval("=IF(TRUE(),1,2)"), Value::Number(1.0));
    }

    #[test]
    fn and_composition() {
        assert_eq!(eval("=AND(TRUE(),TRUE())"), Value::Boolean(true));
        assert_eq!(eval("=AND(TRUE(),FALSE())"), Value::Boolean(false));
    }

    #[test]
    fn comparison_true() {
        assert_eq!(eval("=TRUE()=TRUE"), Value::Boolean(true));
    }

    #[test]
    fn arity_error_with_arg() {
        assert_eq!(e(&eval("=TRUE(1)")), CalcError::Value);
    }

    #[test]
    fn arity_error_multiple_args() {
        assert_eq!(e(&eval("=TRUE(1,2)")), CalcError::Value);
    }

    #[test]
    fn case_insensitive_call() {
        assert_eq!(eval("=true()"), Value::Boolean(true));
    }

    #[test]
    fn in_cell_formula() {
        let v = eval_with(&[("A1", Value::Boolean(true))], "=AND(A1,TRUE())");
        assert_eq!(v, Value::Boolean(true));
    }
}
