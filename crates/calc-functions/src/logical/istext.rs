//! `ISTEXT(value)` — TRUE when `value` is text (including the empty
//! string, which is distinct from blank). Spec: `docs/functions/ISTEXT.md`.

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
    Ok(Value::Boolean(matches!(v, Value::Text(_))))
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
    fn text_true() {
        assert!(b(&eval(r#"=ISTEXT("abc")"#)));
        assert!(b(&eval(r#"=ISTEXT(" ")"#)));
    }

    #[test]
    fn empty_string_true() {
        // "" is text, not blank.
        assert!(b(&eval(r#"=ISTEXT("")"#)));
    }

    #[test]
    fn numeric_text_true() {
        assert!(b(&eval(r#"=ISTEXT("3")"#)));
    }

    #[test]
    fn number_false() {
        assert!(!b(&eval("=ISTEXT(3)")));
        assert!(!b(&eval("=ISTEXT(3.5)")));
    }

    #[test]
    fn boolean_false() {
        assert!(!b(&eval("=ISTEXT(TRUE)")));
    }

    #[test]
    fn blank_false() {
        assert!(!b(&eval("=ISTEXT(A1)")));
    }

    #[test]
    fn text_cell_true() {
        let v = eval_with(&[("A1", "x".into())], "=ISTEXT(A1)");
        assert!(b(&v));
    }

    #[test]
    fn number_cell_false() {
        let v = eval_with(&[("A1", 5.0.into())], "=ISTEXT(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn expression_result() {
        assert!(b(&eval(r#"=ISTEXT("a"&"b")"#)));
        assert!(!b(&eval("=ISTEXT(1+1)")));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ISTEXT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISTEXT(1,2)")), CalcError::Value);
        assert_eq!(e(&eval("=ISTEXT()")), CalcError::Value);
    }
}
