//! `OR(logical1, [logical2], ...)` — TRUE when any logical arg is TRUE.
//! Spec: `docs/functions/OR.md`. Same coercion and all-args-evaluated
//! rules as [`crate::functions::and`].

use crate::ast::Expr;
use crate::eval::{EvalContext, EvalError};
use crate::functions::{MAX_ARGS, check_arity, helpers};
use crate::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    match helpers::collect_booleans(ctx, args)? {
        Err(e) => Ok(Value::Error(e)),
        Ok(bs) => Ok(Value::Boolean(bs.iter().any(|b| *b))),
    }
}

#[cfg(test)]
mod tests {
    use super::super::helpers::test_support::*;
    use crate::{CalcError, Value};

    fn b(v: &Value) -> bool {
        match v {
            Value::Boolean(b) => *b,
            o => panic!("expected bool, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn all_false() {
        assert!(!b(&eval("=OR(FALSE,FALSE)")));
    }

    #[test]
    fn one_true() {
        assert!(b(&eval("=OR(TRUE,FALSE)")));
    }

    #[test]
    fn numbers_coerce() {
        assert!(!b(&eval("=OR(0,0)")));
        assert!(b(&eval("=OR(0,7)")));
        assert!(b(&eval("=OR(-1,0)")));
    }

    #[test]
    fn range_or() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(false)),
                ("A2", Value::Boolean(false)),
                ("A3", Value::Boolean(true)),
            ],
            "=OR(A1:A3)",
        );
        assert!(b(&v));
    }

    #[test]
    fn range_ignores_text_and_blank() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(false)),
                ("A2", "x".into()),
                ("A4", Value::Boolean(false)),
            ],
            "=OR(A1:A4)",
        );
        assert!(!b(&v));
    }

    #[test]
    fn range_only_text_value_error() {
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=OR(A1:A3)");
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn direct_text_value_error() {
        assert_eq!(e(&eval(r#"=OR(FALSE,"x")"#)), CalcError::Value);
    }

    #[test]
    fn cell_refs() {
        let v = eval_with(
            &[("A1", Value::Boolean(false)), ("B1", Value::Boolean(true))],
            "=OR(A1,B1)",
        );
        assert!(b(&v));
    }

    #[test]
    fn sibling_error_propagates() {
        assert_eq!(e(&eval("=OR(FALSE,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=OR()")), CalcError::Value);
    }
}
