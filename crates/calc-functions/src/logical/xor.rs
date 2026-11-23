//! `XOR(logical1, [logical2], ...)` — TRUE when an odd number of the
//! logical arguments are TRUE. Spec: `docs/functions/XOR.md`.
//!
//! Shares the AND/OR scanning model via
//! [`crate::common::coercion::collect_booleans`]: scalars coerce through
//! `Value::to_boolean`, range members use only numbers and booleans
//! (text and blanks ignored), errors propagate, and zero effective
//! logicals yield `#VALUE!`.

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
        Ok(bs) => Ok(Value::Boolean(bs.iter().filter(|b| **b).count() % 2 == 1)),
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
    fn odd_count_true() {
        assert!(b(&eval("=XOR(TRUE,FALSE)")));
        assert!(b(&eval("=XOR(TRUE,TRUE,TRUE)")));
    }

    #[test]
    fn even_count_false() {
        assert!(!b(&eval("=XOR(TRUE,TRUE)")));
        assert!(!b(&eval("=XOR(3>2,2>3,1>0)")));
    }

    #[test]
    fn single_arg() {
        assert!(b(&eval("=XOR(TRUE)")));
        assert!(!b(&eval("=XOR(FALSE)")));
    }

    #[test]
    fn numbers_coerce() {
        assert!(b(&eval("=XOR(1,0)")));
        assert!(!b(&eval("=XOR(3,-2)")));
        assert!(!b(&eval("=XOR(0)")));
    }

    #[test]
    fn text_true_coerces() {
        assert!(b(&eval(r#"=XOR("TRUE")"#)));
    }

    #[test]
    fn direct_text_value_error() {
        assert_eq!(e(&eval(r#"=XOR("abc")"#)), CalcError::Value);
    }

    #[test]
    fn range_counts_booleans_and_numbers() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", 1.0.into()),
                ("A3", 0.0.into()),
            ],
            "=XOR(A1:A3)",
        );
        assert!(!b(&v)); // two trues -> even
    }

    #[test]
    fn range_ignores_text_and_blank() {
        let v = eval_with(
            &[("A1", Value::Boolean(true)), ("A2", "x".into())],
            "=XOR(A1:A3)",
        );
        assert!(b(&v));
    }

    #[test]
    fn no_effective_logicals_value_error() {
        let v = eval_with(&[("A1", "abc".into())], "=XOR(A1:A3)");
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn mixed_scalar_and_range() {
        let v = eval_with(
            &[("A1", Value::Boolean(true)), ("A2", Value::Boolean(false))],
            "=XOR(A1:A2,FALSE)",
        );
        assert!(b(&v));
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::DivZero))], "=XOR(A1,TRUE)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn sibling_error_propagates() {
        assert_eq!(e(&eval("=XOR(TRUE,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=XOR()")), CalcError::Value);
    }

    #[test]
    fn array_argument() {
        assert!(b(&eval("=XOR({TRUE,FALSE,FALSE})")));
        assert!(!b(&eval("=XOR({TRUE,TRUE,FALSE})")));
    }
}
