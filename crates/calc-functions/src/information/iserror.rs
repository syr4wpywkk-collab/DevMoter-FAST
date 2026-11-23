//! `ISERROR(value)` — TRUE when `value` is any error value, including
//! `#N/A`. Consumes error arguments rather than propagating them.
//! Spec: `docs/functions/ISERROR.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval_arg(&args[0])?.into_value();
    Ok(Value::Boolean(v.is_error()))
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
        assert!(b(&eval("=ISERROR(1/0)")));
    }

    #[test]
    fn na_true() {
        assert!(b(&eval("=ISERROR(NA())")));
        assert!(b(&eval("=ISERROR(#N/A)")));
    }

    #[test]
    fn all_error_literals_true() {
        for lit in [
            "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A", "#NULL!",
        ] {
            assert!(b(&eval(&format!("=ISERROR({lit})"))), "{lit}");
        }
    }

    #[test]
    fn non_errors_false() {
        assert!(!b(&eval("=ISERROR(0)")));
        assert!(!b(&eval("=ISERROR(-1.5)")));
        assert!(!b(&eval(r#"=ISERROR("")"#)));
        assert!(!b(&eval(r##"=ISERROR("#N/A")"##)));
        assert!(!b(&eval("=ISERROR(TRUE)")));
        assert!(!b(&eval("=ISERROR(FALSE)")));
    }

    #[test]
    fn blank_cell_false() {
        assert!(!b(&eval("=ISERROR(A1)")));
    }

    #[test]
    fn text_cell_false() {
        let v = eval_with(&[("A1", "x".into())], "=ISERROR(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn error_cell_true() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=ISERROR(A1)");
        assert!(b(&v));
    }

    #[test]
    fn lookup_miss_true() {
        let v = eval_with(
            &[
                ("B1", "a".into()),
                ("C1", 1.0.into()),
                ("B2", "b".into()),
                ("C2", 2.0.into()),
            ],
            r#"=ISERROR(VLOOKUP("q",B1:C2,2,FALSE))"#,
        );
        assert!(b(&v));
    }

    #[test]
    fn iferror_guard() {
        let v = eval(r#"=IF(ISERROR(1/0),"bad","ok")"#);
        assert_eq!(v, Value::Text("bad".into()));
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISERROR()")), CalcError::Value);
        assert_eq!(e(&eval("=ISERROR(1,2)")), CalcError::Value);
    }
}
