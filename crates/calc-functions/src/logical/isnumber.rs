//! `ISNUMBER(value)` — TRUE when `value` is a number. No coercion of
//! numeric-looking text. Spec: `docs/functions/ISNUMBER.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval_arg(&args[0])?.into_value();
    if let Some(e) = v.error() {
        return Ok(Value::Error(e));
    }
    Ok(Value::Boolean(matches!(v, Value::Number(_))))
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
    fn numbers_true() {
        assert!(b(&eval("=ISNUMBER(3)")));
        assert!(b(&eval("=ISNUMBER(3.5)")));
        assert!(b(&eval("=ISNUMBER(-1e10)")));
    }

    #[test]
    fn numeric_text_not_coerced() {
        assert!(!b(&eval(r#"=ISNUMBER("3")"#)));
    }

    #[test]
    fn text_false() {
        assert!(!b(&eval(r#"=ISNUMBER("abc")"#)));
        assert!(!b(&eval(r#"=ISNUMBER("")"#)));
    }

    #[test]
    fn boolean_false() {
        assert!(!b(&eval("=ISNUMBER(TRUE)")));
        assert!(!b(&eval("=ISNUMBER(FALSE)")));
    }

    #[test]
    fn blank_false() {
        assert!(!b(&eval("=ISNUMBER(A1)")));
    }

    #[test]
    fn number_cell_true() {
        let v = eval_with(&[("A1", 42.0.into())], "=ISNUMBER(A1)");
        assert!(b(&v));
    }

    #[test]
    fn text_cell_false() {
        let v = eval_with(&[("A1", "5".into())], "=ISNUMBER(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn expression_result() {
        assert!(b(&eval("=ISNUMBER(1+1)")));
        assert!(b(&eval("=ISNUMBER(ABS(-2))")));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ISNUMBER(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(&[("A1", 1.0.into())], "=ISNUMBER(A1/0)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISNUMBER(1,2)")), CalcError::Value);
        assert_eq!(e(&eval("=ISNUMBER()")), CalcError::Value);
    }
}
