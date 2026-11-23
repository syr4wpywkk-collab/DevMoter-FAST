//! `ISLOGICAL(value)` — TRUE when `value` is a boolean. Numbers and
//! text are not logicals; error arguments propagate. Spec:
//! `docs/functions/ISLOGICAL.md`.

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
    Ok(Value::Boolean(matches!(v, Value::Boolean(_))))
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
    fn literals_true() {
        assert!(b(&eval("=ISLOGICAL(TRUE)")));
        assert!(b(&eval("=ISLOGICAL(FALSE)")));
    }

    #[test]
    fn boolean_cell_true() {
        let v = eval_with(&[("A1", Value::Boolean(false))], "=ISLOGICAL(A1)");
        assert!(b(&v));
    }

    #[test]
    fn comparison_result_true() {
        assert!(b(&eval("=ISLOGICAL(1=1)")));
        assert!(b(&eval("=ISLOGICAL(2>3)")));
    }

    #[test]
    fn number_false() {
        assert!(!b(&eval("=ISLOGICAL(1)")));
        assert!(!b(&eval("=ISLOGICAL(0)")));
    }

    #[test]
    fn text_false() {
        assert!(!b(&eval(r#"=ISLOGICAL("TRUE")"#)));
        assert!(!b(&eval(r#"=ISLOGICAL("FALSE")"#)));
        assert!(!b(&eval(r#"=ISLOGICAL("")"#)));
    }

    #[test]
    fn blank_cell_false() {
        assert!(!b(&eval("=ISLOGICAL(A1)")));
    }

    #[test]
    fn number_cell_false() {
        let v = eval_with(&[("A1", 1.0.into())], "=ISLOGICAL(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ISLOGICAL(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=ISLOGICAL(NA())")), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISLOGICAL()")), CalcError::Value);
        assert_eq!(e(&eval("=ISLOGICAL(1,2)")), CalcError::Value);
    }

    #[test]
    fn nested_isfunction_result() {
        assert!(b(&eval("=ISLOGICAL(ISNUMBER(1))")));
    }
}
