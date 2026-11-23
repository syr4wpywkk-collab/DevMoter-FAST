//! `ISERR(value)` — TRUE when `value` is any error value except
//! `#N/A`. Consumes error arguments rather than propagating them.
//! Spec: `docs/functions/ISERR.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval_arg(&args[0])?.into_value();
    // SPEC-OPEN: errors newer than `#N/A` (`#SPILL!`, `#CALC!`,
    // `#CIRC!`) count as errors here — only `#N/A` is excluded.
    Ok(Value::Boolean(
        matches!(v, Value::Error(e) if e != CalcError::NA),
    ))
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
    fn divzero_true() {
        assert!(b(&eval("=ISERR(1/0)")));
    }

    #[test]
    fn value_error_true() {
        assert!(b(&eval(r#"=ISERR("x"+1)"#)));
    }

    #[test]
    fn ref_error_true() {
        assert!(b(&eval("=ISERR(#REF!)")));
    }

    #[test]
    fn name_error_true() {
        assert!(b(&eval("=ISERR(#NAME?)")));
    }

    #[test]
    fn num_error_true() {
        assert!(b(&eval("=ISERR(#NUM!)")));
    }

    #[test]
    fn null_error_true() {
        assert!(b(&eval("=ISERR(#NULL!)")));
    }

    #[test]
    fn na_false() {
        assert!(!b(&eval("=ISERR(NA())")));
        assert!(!b(&eval("=ISERR(#N/A)")));
    }

    #[test]
    fn non_errors_false() {
        assert!(!b(&eval("=ISERR(0)")));
        assert!(!b(&eval(r#"=ISERR("")"#)));
        assert!(!b(&eval("=ISERR(TRUE)")));
        assert!(!b(&eval("=ISERR(A1)")));
    }

    #[test]
    fn error_cell_true() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Ref))], "=ISERR(A1)");
        assert!(b(&v));
    }

    #[test]
    fn text_cell_false() {
        let v = eval_with(&[("A1", "text".into())], "=ISERR(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn guards_let_na_through() {
        // Classic ISERR/ISNA split: ISERR excludes #N/A, ISNA catches it.
        assert!(b(&eval("=ISNA(NA())")));
        assert!(!b(&eval("=ISERR(NA())")));
        assert!(b(&eval("=ISERROR(NA())")));
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISERR()")), CalcError::Value);
        assert_eq!(e(&eval("=ISERR(1,2)")), CalcError::Value);
    }
}
