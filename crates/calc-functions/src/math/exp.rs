//! `EXP(number)` — e raised to `number`. Spec: `docs/functions/EXP.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let r = x.exp();
    if r.is_infinite() {
        // Overflow -> #NUM! (never inf). Underflow to 0 is not an error.
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(r))
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
    fn basic() {
        assert_eq!(n(&eval("=EXP(0)")), 1.0);
        assert!((n(&eval("=EXP(1)")) - std::f64::consts::E).abs() < 1e-15);
        assert!((n(&eval("=EXP(2)")) - 7.38905609893065).abs() < 1e-12);
    }

    #[test]
    fn negative() {
        assert!((n(&eval("=EXP(-1)")) - 1.0 / std::f64::consts::E).abs() < 1e-15);
    }

    #[test]
    fn overflow_num() {
        assert_eq!(e(&eval("=EXP(1000)")), CalcError::Num);
        assert_eq!(e(&eval("=EXP(710)")), CalcError::Num);
    }

    #[test]
    fn underflow_zero_not_error() {
        assert_eq!(n(&eval("=EXP(-746)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=EXP("0")"#)), 1.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=EXP("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=EXP(FALSE)")), 1.0);
        assert!((n(&eval("=EXP(TRUE)")) - std::f64::consts::E).abs() < 1e-15);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=EXP(A1)")), 1.0);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 2.0.into())], "=EXP(A1)");
        assert!((n(&v) - 7.38905609893065).abs() < 1e-12);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=EXP(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=EXP(1,2)")), CalcError::Value);
    }
}
