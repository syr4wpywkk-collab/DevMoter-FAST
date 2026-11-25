//! `SQRTPI(number)` — `sqrt(number * pi)`. Spec: `docs/functions/SQRTPI.md`.
//!
//! `number < 0` -> `#NUM!` (sqrt domain), matching `SQRT`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match coercion::eval_number(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(x) if x < 0.0 => Ok(Value::Error(CalcError::Num)),
        Ok(x) => Ok(Value::Number((x * std::f64::consts::PI).sqrt())),
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
    fn sqrtpi_one() {
        assert!((n(&eval("=SQRTPI(1)")) - 1.772453850905516).abs() < 1e-14);
    }

    #[test]
    fn sqrtpi_two() {
        assert!((n(&eval("=SQRTPI(2)")) - 2.5066282746310002).abs() < 1e-14);
    }

    #[test]
    fn sqrtpi_zero() {
        assert_eq!(n(&eval("=SQRTPI(0)")), 0.0);
    }

    #[test]
    fn sqrtpi_equiv_sqrt_pi_times() {
        assert_eq!(n(&eval("=SQRTPI(3)")), n(&eval("=SQRT(PI()*3)")));
    }

    #[test]
    fn sqrtpi_negative_num() {
        assert_eq!(e(&eval("=SQRTPI(-1)")), CalcError::Num);
    }

    #[test]
    fn sqrtpi_text_coercion() {
        assert!((n(&eval("=SQRTPI(\"2\")")) - 2.5066282746310002).abs() < 1e-14);
    }

    #[test]
    fn sqrtpi_bad_text() {
        assert_eq!(e(&eval("=SQRTPI(\"x\")")), CalcError::Value);
    }

    #[test]
    fn sqrtpi_error_propagates() {
        assert_eq!(e(&eval("=SQRTPI(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn sqrtpi_blank_is_zero() {
        let v = eval_with(&[("A1", Value::Blank)], "=SQRTPI(A1)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn sqrtpi_arity() {
        assert_eq!(e(&eval("=SQRTPI()")), CalcError::Value);
        assert_eq!(e(&eval("=SQRTPI(1,2)")), CalcError::Value);
    }
}
