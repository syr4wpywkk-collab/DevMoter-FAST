//! `IFNA(value, value_if_na)` — returns `value`, or `value_if_na` only
//! when `value` evaluates to `#N/A`. Lazy: the fallback is evaluated
//! only on `#N/A`. Spec: `docs/functions/IFNA.md`.
//!
//! Narrower than [`super::iferror`]: every non-`#N/A` error propagates
//! unchanged. Only `Value::Error`s are inspected — fatal `EvalError`s
//! (step budget) are not caught.
//!
//! SPEC-OPEN: whether `IFNA(x,)` with a missing-but-present second
//! argument yields 0 (same open question as `IFERROR`, P1-IFERROR-011);
//! a missing second argument is rejected with `#VALUE!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval(&args[0])?;
    if matches!(v, Value::Error(CalcError::NA)) {
        ctx.eval(&args[1])
    } else {
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

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
    fn catches_na() {
        assert_eq!(n(&eval("=IFNA(#N/A,1)")), 1.0);
    }

    #[test]
    fn passes_through_value() {
        assert_eq!(n(&eval("=IFNA(5,1)")), 5.0);
    }

    #[test]
    fn div_zero_propagates() {
        assert_eq!(e(&eval("=IFNA(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn value_error_propagates() {
        assert_eq!(e(&eval(r#"=IFNA("x"+1,1)"#)), CalcError::Value);
    }

    #[test]
    fn name_error_propagates() {
        assert_eq!(e(&eval("=IFNA(NOSUCHFN(),1)")), CalcError::Name);
    }

    #[test]
    fn ref_error_propagates() {
        assert_eq!(e(&eval("=IFNA(Nosuch!A1,1)")), CalcError::Ref);
    }

    #[test]
    fn na_fallback_text() {
        assert_eq!(
            eval(r#"=IFNA(#N/A,"not found")"#),
            Value::Text("not found".into())
        );
    }

    #[test]
    fn fallback_error_is_result() {
        assert_eq!(e(&eval("=IFNA(#N/A,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn non_error_types_passthrough() {
        assert_eq!(eval(r#"=IFNA("t",0)"#), Value::Text("t".into()));
        assert_eq!(eval("=IFNA(TRUE,0)"), Value::Boolean(true));
    }

    #[test]
    fn vlookup_pattern() {
        let v = eval(r#"=IFNA(VLOOKUP(9,{1,2;3,4},1,FALSE),"nf")"#);
        assert_eq!(v, Value::Text("nf".into()));
    }

    #[test]
    fn blank_cell_is_not_na() {
        let v = eval_with(&[], r#"=IFNA(A1,"fallback")"#);
        assert_eq!(v, Value::Blank);
    }

    #[test]
    fn nested_ifna() {
        assert_eq!(n(&eval("=IFNA(IFNA(#N/A,#N/A),7)")), 7.0);
    }

    #[test]
    fn cell_ref_na() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=IFNA(A1,3)");
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn missing_fallback_arity_error() {
        assert_eq!(e(&eval("=IFNA(#N/A)")), CalcError::Value);
    }
}
