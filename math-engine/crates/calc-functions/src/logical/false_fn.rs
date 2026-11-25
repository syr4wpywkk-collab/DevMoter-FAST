//! `FALSE()` — returns the logical value FALSE.
//! Spec: `docs/functions/FALSE.md`.
//!
//! The bare word `FALSE` (no parentheses) is already handled by the
//! parser as a `Literal::Bool(false)` — see `parser.rs::classify_word` —
//! so only the call form is implemented here.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(_ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 0, 0) {
        return Ok(Value::Error(e));
    }
    Ok(Value::Boolean(false))
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
    fn returns_false() {
        assert_eq!(eval("=FALSE()"), Value::Boolean(false));
    }

    #[test]
    fn bare_literal_alias() {
        assert_eq!(eval("=FALSE"), Value::Boolean(false));
    }

    #[test]
    fn numeric_coercion() {
        assert_eq!(eval("=FALSE()+0"), Value::Number(0.0));
        assert_eq!(eval("=FALSE()*5"), Value::Number(0.0));
    }

    #[test]
    fn text_coercion() {
        assert_eq!(eval(r#"=FALSE()&"""#), Value::Text("FALSE".into()));
    }

    #[test]
    fn not_false_is_true() {
        assert_eq!(eval("=NOT(FALSE())"), Value::Boolean(true));
    }

    #[test]
    fn if_condition() {
        assert_eq!(eval("=IF(FALSE(),1,2)"), Value::Number(2.0));
    }

    #[test]
    fn or_composition() {
        assert_eq!(eval("=OR(FALSE(),FALSE())"), Value::Boolean(false));
        assert_eq!(eval("=OR(FALSE(),TRUE())"), Value::Boolean(true));
    }

    #[test]
    fn comparison_false() {
        assert_eq!(eval("=FALSE()=FALSE"), Value::Boolean(true));
    }

    #[test]
    fn arity_error_with_arg() {
        assert_eq!(e(&eval("=FALSE(1)")), CalcError::Value);
    }

    #[test]
    fn arity_error_multiple_args() {
        assert_eq!(e(&eval("=FALSE(1,2)")), CalcError::Value);
    }

    #[test]
    fn case_insensitive_call() {
        assert_eq!(eval("=false()"), Value::Boolean(false));
    }

    #[test]
    fn in_cell_formula() {
        let v = eval_with(&[("A1", Value::Boolean(false))], "=OR(A1,FALSE())");
        assert_eq!(v, Value::Boolean(false));
    }
}
