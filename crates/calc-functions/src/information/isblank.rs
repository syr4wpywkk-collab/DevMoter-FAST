//! `ISBLANK(value)` — TRUE when `value` refers to an empty cell. Empty
//! text (`""`), `0`, `FALSE` and `" "` are NOT blank. Error arguments
//! propagate. Spec: `docs/functions/ISBLANK.md`.

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
    Ok(Value::Boolean(v.is_blank()))
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
    fn empty_cell_true() {
        assert!(b(&eval("=ISBLANK(A1)")));
    }

    #[test]
    fn empty_string_cell_false() {
        let v = eval_with(&[("A1", "".into())], "=ISBLANK(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn zero_cell_false() {
        let v = eval_with(&[("A1", 0.0.into())], "=ISBLANK(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn false_cell_false() {
        let v = eval_with(&[("A1", Value::Boolean(false))], "=ISBLANK(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn space_text_cell_false() {
        let v = eval_with(&[("A1", " ".into())], "=ISBLANK(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn literal_empty_string_false() {
        assert!(!b(&eval(r#"=ISBLANK("")"#)));
    }

    #[test]
    fn number_cell_false() {
        let v = eval_with(&[("A1", 42.0.into())], "=ISBLANK(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn text_cell_false() {
        let v = eval_with(&[("A1", "x".into())], "=ISBLANK(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ISBLANK(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=ISBLANK(NA())")), CalcError::NA);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(&[("A1", 1.0.into())], "=ISBLANK(A1/0)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn range_is_not_blank() {
        // SPEC-OPEN: implicit-intersection vs array semantics for a
        // range argument; a multi-cell range collapses to an array
        // value, which is not Blank.
        assert!(!b(&eval("=ISBLANK(A1:B2)")));
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISBLANK()")), CalcError::Value);
        assert_eq!(e(&eval("=ISBLANK(1,2)")), CalcError::Value);
    }
}
