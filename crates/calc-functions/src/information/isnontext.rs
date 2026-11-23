//! `ISNONTEXT(value)` — TRUE when `value` is not text; the inverse of
//! `ISTEXT`. Blank cells return TRUE. Error arguments propagate.
//! Spec: `docs/functions/ISNONTEXT.md`.

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
    Ok(Value::Boolean(!matches!(v, Value::Text(_))))
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
    fn text_false() {
        assert!(!b(&eval(r#"=ISNONTEXT("abc")"#)));
        assert!(!b(&eval(r#"=ISNONTEXT("")"#)));
    }

    #[test]
    fn number_true() {
        assert!(b(&eval("=ISNONTEXT(42)")));
        assert!(b(&eval("=ISNONTEXT(-3.5)")));
    }

    #[test]
    fn boolean_true() {
        assert!(b(&eval("=ISNONTEXT(TRUE)")));
        assert!(b(&eval("=ISNONTEXT(FALSE)")));
    }

    #[test]
    fn blank_cell_true() {
        // Asymmetric vs ISBLANK: a blank cell is "not text" -> TRUE.
        assert!(b(&eval("=ISNONTEXT(A1)")));
    }

    #[test]
    fn text_cell_false() {
        let v = eval_with(&[("A1", "x".into())], "=ISNONTEXT(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn empty_string_cell_false() {
        let v = eval_with(&[("A1", "".into())], "=ISNONTEXT(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn number_cell_true() {
        let v = eval_with(&[("A1", 7.0.into())], "=ISNONTEXT(A1)");
        assert!(b(&v));
    }

    #[test]
    fn inverse_of_istext() {
        for (f, want) in [
            (r#"=ISTEXT("a")"#, true),
            ("=ISTEXT(1)", false),
            ("=ISTEXT(TRUE)", false),
        ] {
            assert_eq!(b(&eval(f)), want);
            let neg = f.replacen("ISTEXT", "ISNONTEXT", 1);
            assert_eq!(b(&eval(&neg)), !want);
        }
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ISNONTEXT(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=ISNONTEXT(NA())")), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISNONTEXT()")), CalcError::Value);
        assert_eq!(e(&eval("=ISNONTEXT(1,2)")), CalcError::Value);
    }
}
