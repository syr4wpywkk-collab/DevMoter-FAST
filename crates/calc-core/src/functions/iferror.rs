//! `IFERROR(value, value_if_error)` — returns `value`, or
//! `value_if_error` when `value` evaluates to any error. Lazy: the
//! fallback is evaluated only on error. Spec: `docs/functions/IFERROR.md`.
//!
//! Catches every `CalcError` code including `#CIRC!`. Only
//! `Value::Error`s are caught — fatal `EvalError`s (step budget) are not.
//!
//! SPEC-OPEN (P1-IFERROR-011): `IFERROR(x)` with a missing second
//! argument is rejected here with `#VALUE!` (Excel likely rejects at
//! formula-entry time); unverified.

use crate::ast::Expr;
use crate::eval::{EvalContext, EvalError};
use crate::functions::check_arity;
use crate::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval(&args[0])?;
    if v.is_error() {
        ctx.eval(&args[1])
    } else {
        Ok(v)
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
    fn catches_div_zero() {
        assert_eq!(n(&eval("=IFERROR(1/0,99)")), 99.0);
    }

    #[test]
    fn passes_through_value() {
        assert_eq!(n(&eval("=IFERROR(42,99)")), 42.0);
    }

    #[test]
    fn text_fallback() {
        assert_eq!(eval("=IFERROR(0/0,\"err\")"), Value::Text("err".into()));
    }

    #[test]
    fn nested_if_nonerror() {
        assert_eq!(n(&eval("=IFERROR(IF(FALSE,1/0,5),-1)")), 5.0);
    }

    #[test]
    fn nested_if_error() {
        assert_eq!(n(&eval("=IFERROR(IF(TRUE,1/0,5),-1)")), -1.0);
    }

    #[test]
    fn catches_coercion_error() {
        assert_eq!(
            eval(r#"=IFERROR("x"+1,"caught")"#),
            Value::Text("caught".into())
        );
    }

    #[test]
    fn catches_name_error() {
        assert_eq!(n(&eval("=IFERROR(NOSUCHFN(),7)")), 7.0);
    }

    #[test]
    fn catches_ref_error() {
        assert_eq!(n(&eval("=IFERROR(Nosuch!A1,3)")), 3.0);
    }

    #[test]
    fn cell_passthrough() {
        let v = eval_with(&[("A1", 7.0.into())], r#"=IFERROR(A1,"blank")"#);
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn blank_cell_is_blank_not_error() {
        // SPEC-OPEN P1-IFERROR-009: a blank ref is not an error, so it is
        // returned as-is (Blank, which displays as 0 in Excel).
        let v = eval_with(&[], r#"=IFERROR(A1,"fallback")"#);
        assert_eq!(v, Value::Blank);
    }

    #[test]
    fn nested_iferror() {
        assert_eq!(
            eval("=IFERROR(IFERROR(1/0,1/0),\"deep\")"),
            Value::Text("deep".into())
        );
    }

    #[test]
    fn fallback_error_propagates() {
        assert_eq!(e(&eval("=IFERROR(1/0,#N/A)")), CalcError::NA);
    }

    #[test]
    fn non_error_types_passthrough() {
        assert_eq!(eval(r#"=IFERROR("t",0)"#), Value::Text("t".into()));
        assert_eq!(eval("=IFERROR(TRUE,0)"), Value::Boolean(true));
    }

    #[test]
    fn missing_fallback_arity_error() {
        // SPEC-OPEN P1-IFERROR-011: currently a #VALUE! arity error.
        assert_eq!(e(&eval("=IFERROR(1/0)")), CalcError::Value);
    }
}
