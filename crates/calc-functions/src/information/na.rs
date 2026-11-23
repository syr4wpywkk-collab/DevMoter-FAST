//! `NA()` — returns the `#N/A` error value. Spec:
//! `docs/functions/NA.md`. Not volatile; `NA()` is constant.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(_ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 0, 0) {
        return Ok(Value::Error(e));
    }
    Ok(Value::Error(CalcError::NA))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn returns_na() {
        assert_eq!(e(&eval("=NA()")), CalcError::NA);
    }

    #[test]
    fn isna_true() {
        assert_eq!(eval("=ISNA(NA())"), Value::Boolean(true));
    }

    #[test]
    fn iserror_true() {
        assert_eq!(eval("=ISERROR(NA())"), Value::Boolean(true));
    }

    #[test]
    fn iserr_false() {
        assert_eq!(eval("=ISERR(NA())"), Value::Boolean(false));
    }

    #[test]
    fn propagates_through_arithmetic() {
        assert_eq!(e(&eval("=NA()+5")), CalcError::NA);
        assert_eq!(e(&eval("=NA()*2")), CalcError::NA);
    }

    #[test]
    fn propagates_through_functions() {
        assert_eq!(e(&eval("=N(NA())")), CalcError::NA);
        assert_eq!(e(&eval("=ABS(NA())")), CalcError::NA);
    }

    #[test]
    fn if_branch_returns_na() {
        let v = eval_with(&[("A1", "".into())], r#"=IF(A1="",NA(),A1)"#);
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=NA(1)")), CalcError::Value);
        assert_eq!(e(&eval("=NA(1,2)")), CalcError::Value);
    }

    #[test]
    fn error_type_seven() {
        match eval("=ERROR.TYPE(NA())") {
            Value::Number(n) => assert_eq!(n, 7.0),
            o => panic!("expected 7, got {o:?}"),
        }
    }

    #[test]
    fn type_is_sixteen() {
        match eval("=TYPE(NA())") {
            Value::Number(n) => assert_eq!(n, 16.0),
            o => panic!("expected 16, got {o:?}"),
        }
    }

    #[test]
    fn distinct_from_value_error() {
        assert_ne!(e(&eval("=NA()")), CalcError::Value);
    }
}
