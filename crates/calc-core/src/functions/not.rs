//! `NOT(logical)` — reverses a logical value. Exactly one argument.
//! Spec: `docs/functions/NOT.md`.

use crate::ast::Expr;
use crate::eval::{EvalContext, EvalError};
use crate::functions::check_arity;
use crate::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval(&args[0])?;
    if let Some(e) = v.error() {
        return Ok(Value::Error(e));
    }
    match v.to_boolean() {
        Ok(b) => Ok(Value::Boolean(!b)),
        Err(e) => Ok(Value::Error(e)),
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
    fn not_true() {
        assert!(!b(&eval("=NOT(TRUE)")));
    }

    #[test]
    fn not_false() {
        assert!(b(&eval("=NOT(FALSE)")));
    }

    #[test]
    fn numbers() {
        assert!(b(&eval("=NOT(0)")));
        assert!(!b(&eval("=NOT(1)")));
        assert!(!b(&eval("=NOT(-5)")));
    }

    #[test]
    fn text_value_error() {
        assert_eq!(e(&eval(r#"=NOT("x")"#)), CalcError::Value);
    }

    #[test]
    fn text_true_coerces() {
        // SPEC-OPEN (NOT spec): whether Excel coerces "TRUE" text is
        // unconfirmed; direct-arg rules coerce it, so NOT("TRUE") = FALSE.
        assert!(!b(&eval(r#"=NOT("TRUE")"#)));
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", Value::Boolean(true))], "=NOT(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn blank_ref() {
        // SPEC-OPEN P1-NOT-008: blank -> FALSE -> NOT -> TRUE.
        let v = eval_with(&[], "=NOT(A1)");
        assert!(b(&v));
    }

    #[test]
    fn expression_arg() {
        assert!(!b(&eval("=NOT(1=1)")));
        assert!(b(&eval("=NOT(2>3)")));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=NOT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=NOT(1,2)")), CalcError::Value);
    }
}
