//! `AND(logical1, [logical2], ...)` — TRUE when all logical args are TRUE.
//! Spec: `docs/functions/AND.md`.
//!
//! All arguments are evaluated (Excel is not short-circuit; plan §5).
//! SPEC-OPEN P1-AND-009: whether a sibling error propagates over a
//! determined FALSE — currently propagates (expected Excel behavior).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    match coercion::collect_booleans(ctx, args)? {
        Err(e) => Ok(Value::Error(e)),
        Ok(bs) => Ok(Value::Boolean(bs.iter().all(|b| *b))),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

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
    fn all_true() {
        assert!(b(&eval("=AND(TRUE,TRUE)")));
    }

    #[test]
    fn one_false() {
        assert!(!b(&eval("=AND(TRUE,FALSE)")));
    }

    #[test]
    fn numbers_coerce() {
        assert!(b(&eval("=AND(1,2)")));
        assert!(!b(&eval("=AND(1,0)")));
        assert!(b(&eval("=AND(5,-3)")));
    }

    #[test]
    fn range_of_booleans() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", Value::Boolean(true)),
                ("A3", Value::Boolean(true)),
            ],
            "=AND(A1:A3)",
        );
        assert!(b(&v));
    }

    #[test]
    fn range_ignores_text_and_blank() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", "x".into()),
                ("A4", Value::Boolean(true)),
            ],
            "=AND(A1:A4)",
        );
        assert!(b(&v));
    }

    #[test]
    fn range_only_text_value_error() {
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=AND(A1:A3)");
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn direct_text_value_error() {
        assert_eq!(e(&eval(r#"=AND(TRUE,"x")"#)), CalcError::Value);
    }

    #[test]
    fn sibling_error_propagates() {
        // SPEC-OPEN P1-AND-009 (expect propagation).
        assert_eq!(e(&eval("=AND(FALSE,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn cell_refs() {
        let v = eval_with(
            &[("A1", Value::Boolean(true)), ("B1", Value::Boolean(false))],
            "=AND(A1,B1)",
        );
        assert!(!b(&v));
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=AND()")), CalcError::Value);
    }
}
