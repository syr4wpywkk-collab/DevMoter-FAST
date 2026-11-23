//! `IFS(test1, value1, [test2, value2], ...)` — first TRUE condition's
//! paired value. Spec: `docs/functions/IFS.md`.
//!
//! Lazy like `IF`: conditions evaluate left to right and evaluation
//! stops at the first TRUE; only the paired value argument is evaluated,
//! so errors in unselected pairs never surface.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    // A dangling condition without a value is an arity error
    // (SPEC-OPEN: error class; Excel rejects at entry time).
    if args.len() % 2 != 0 {
        return Ok(Value::Error(CalcError::Value));
    }
    for pair in args.chunks_exact(2) {
        let cond = ctx.eval(&pair[0])?;
        if let Some(e) = cond.error() {
            return Ok(Value::Error(e));
        }
        let cond = match cond.to_boolean() {
            Ok(b) => b,
            Err(e) => return Ok(Value::Error(e)),
        };
        if cond {
            return ctx.eval(&pair[1]);
        }
    }
    // No TRUE condition and no default branch -> #N/A.
    Ok(Value::Error(CalcError::NA))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn n(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            o => panic!("expected number, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn first_match_wins() {
        let f = r#"=IFS(A1>90,"A",A1>80,"B",TRUE,"C")"#;
        assert_eq!(
            eval_with(&[("A1", 95.0.into())], f),
            Value::Text("A".into())
        );
        assert_eq!(
            eval_with(&[("A1", 85.0.into())], f),
            Value::Text("B".into())
        );
        assert_eq!(
            eval_with(&[("A1", 50.0.into())], f),
            Value::Text("C".into())
        );
    }

    #[test]
    fn single_pair() {
        assert_eq!(n(&eval("=IFS(TRUE,7)")), 7.0);
    }

    #[test]
    fn lazy_unselected_value() {
        assert_eq!(n(&eval("=IFS(FALSE,1/0,TRUE,7)")), 7.0);
        assert_eq!(n(&eval("=IFS(TRUE,1,1/0,2)")), 1.0);
    }

    #[test]
    fn lazy_unreached_condition() {
        // An erroring condition after the match is never evaluated.
        assert_eq!(n(&eval("=IFS(TRUE,1,1/0,2)")), 1.0);
    }

    #[test]
    fn no_true_is_na() {
        assert_eq!(e(&eval("=IFS(FALSE,1)")), CalcError::NA);
        assert_eq!(e(&eval("=IFS(FALSE,1,FALSE,2)")), CalcError::NA);
    }

    #[test]
    fn odd_arity_error() {
        assert_eq!(e(&eval("=IFS(TRUE,1,FALSE)")), CalcError::Value);
    }

    #[test]
    fn number_condition() {
        assert_eq!(n(&eval("=IFS(0,1,5,2)")), 2.0);
    }

    #[test]
    fn text_condition_value_error() {
        assert_eq!(e(&eval(r#"=IFS("x",1,TRUE,2)"#)), CalcError::Value);
    }

    #[test]
    fn blank_condition_false() {
        // Mirrors IF's SPEC-OPEN P1-IF-012: blank -> FALSE.
        assert_eq!(e(&eval("=IFS(A1,1)")), CalcError::NA);
    }

    #[test]
    fn condition_error_propagates() {
        assert_eq!(e(&eval("=IFS(1/0,1,TRUE,2)")), CalcError::DivZero);
    }

    #[test]
    fn value_error_is_result() {
        assert_eq!(e(&eval("=IFS(TRUE,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IFS(TRUE)")), CalcError::Value);
    }
}
