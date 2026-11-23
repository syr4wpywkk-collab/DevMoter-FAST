//! `IF(logical_test, [value_if_true], [value_if_false])` — lazy branch
//! selection. Spec: `docs/functions/IF.md`.
//!
//! Only the selected branch is evaluated (plan §5): an error in the
//! untaken branch never surfaces.

use crate::ast::Expr;
use crate::eval::{EvalContext, EvalError};
use crate::functions::check_arity;
use crate::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let cond = ctx.eval(&args[0])?;
    if let Some(e) = cond.error() {
        return Ok(Value::Error(e));
    }
    let cond = match cond.to_boolean() {
        Ok(b) => b,
        Err(e) => return Ok(Value::Error(e)),
    };
    match (cond, args.len()) {
        (true, _) => ctx.eval(&args[1]),
        // IF(cond, v) with cond FALSE -> FALSE.
        (false, 2) => Ok(Value::Boolean(false)),
        (false, 3) => ctx.eval(&args[2]),
        _ => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::helpers::test_support::*;
    use crate::{CalcError, Value};

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
    fn true_branch() {
        assert_eq!(n(&eval("=IF(TRUE,1,2)")), 1.0);
    }

    #[test]
    fn false_branch() {
        assert_eq!(n(&eval("=IF(FALSE,1,2)")), 2.0);
    }

    #[test]
    fn lazy_untaken_error_branch() {
        assert_eq!(n(&eval("=IF(FALSE,1/0,42)")), 42.0);
        assert_eq!(n(&eval("=IF(TRUE,42,1/0)")), 42.0);
    }

    #[test]
    fn number_condition() {
        assert_eq!(n(&eval("=IF(1,10,20)")), 10.0);
        assert_eq!(n(&eval("=IF(0,10,20)")), 20.0);
    }

    #[test]
    fn text_condition_value_error() {
        assert_eq!(e(&eval(r#"=IF("x",1,2)"#)), CalcError::Value);
    }

    #[test]
    fn omitted_false_branch() {
        assert_eq!(eval("=IF(FALSE,1)"), Value::Boolean(false));
        assert_eq!(n(&eval("=IF(TRUE,1)")), 1.0);
    }

    #[test]
    fn condition_on_cell() {
        let v = eval_with(&[("A1", 1.0.into())], r#"=IF(A1=1,"one","other")"#);
        assert_eq!(v, Value::Text("one".into()));
        let v = eval_with(&[("A1", 2.0.into())], r#"=IF(A1=1,"one","other")"#);
        assert_eq!(v, Value::Text("other".into()));
    }

    #[test]
    fn blank_condition() {
        // SPEC-OPEN P1-IF-012: blank -> FALSE (expected); confirm in Excel.
        let v = eval_with(&[], r#"=IF(A1,"y","n")"#);
        assert_eq!(v, Value::Text("n".into()));
    }

    #[test]
    fn error_condition_propagates() {
        assert_eq!(e(&eval("=IF(1/0,1,2)")), CalcError::DivZero);
    }

    #[test]
    fn branch_error_is_result() {
        assert_eq!(e(&eval("=IF(TRUE,1/0,2)")), CalcError::DivZero);
    }

    #[test]
    fn nested_if() {
        let f = r#"=IF(A1>10,"big",IF(A1>5,"mid","small"))"#;
        assert_eq!(
            eval_with(&[("A1", 7.0.into())], f),
            Value::Text("mid".into())
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IF(1)")), CalcError::Value);
    }
}
