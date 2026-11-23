//! `ISNA(value)` — TRUE when `value` is the `#N/A` error specifically.
//! Consumes the error argument rather than propagating it. Spec:
//! `docs/functions/ISNA.md`.

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
    Ok(Value::Boolean(matches!(v, Value::Error(CalcError::NA))))
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
    fn na_true() {
        assert!(b(&eval("=ISNA(NA())")));
        assert!(b(&eval("=ISNA(#N/A)")));
    }

    #[test]
    fn other_errors_false() {
        for lit in ["#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#NULL!"] {
            assert!(!b(&eval(&format!("=ISNA({lit})"))), "{lit}");
        }
        assert!(!b(&eval("=ISNA(1/0)")));
    }

    #[test]
    fn non_errors_false() {
        assert!(!b(&eval("=ISNA(0)")));
        assert!(!b(&eval("=ISNA(-1)")));
        assert!(!b(&eval(r##"=ISNA("#N/A")"##)));
        assert!(!b(&eval(r#"=ISNA("")"#)));
        assert!(!b(&eval("=ISNA(TRUE)")));
    }

    #[test]
    fn blank_cell_false() {
        assert!(!b(&eval("=ISNA(A1)")));
    }

    #[test]
    fn na_cell_true() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=ISNA(A1)");
        assert!(b(&v));
    }

    #[test]
    fn other_error_cell_false() {
        let v = eval_with(&[("A1", Value::Error(CalcError::DivZero))], "=ISNA(A1)");
        assert!(!b(&v));
    }

    #[test]
    fn vlookup_miss_true() {
        let v = eval_with(
            &[
                ("B1", "a".into()),
                ("C1", 1.0.into()),
                ("B2", "b".into()),
                ("C2", 2.0.into()),
            ],
            r#"=ISNA(VLOOKUP("q",B1:C2,2,FALSE))"#,
        );
        assert!(b(&v));
    }

    #[test]
    fn ifna_style_guard() {
        let v = eval(r#"=IF(ISNA(VLOOKUP("q",B1:C2,2,FALSE)),"not found","found")"#);
        assert_eq!(v, Value::Text("not found".into()));
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISNA()")), CalcError::Value);
        assert_eq!(e(&eval("=ISNA(1,2)")), CalcError::Value);
    }

    #[test]
    fn distinguishes_na_from_err() {
        assert!(b(&eval("=ISNA(NA())")));
        assert!(!b(&eval("=ISERR(NA())")));
        assert!(b(&eval("=ISERROR(NA())")));
    }
}
