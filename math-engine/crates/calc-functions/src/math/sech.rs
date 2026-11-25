//! `SECH(number)` — hyperbolic secant, `1/cosh(number)`. Spec:
//! `docs/functions/SECH.md` (Excel 2013+).
//!
//! Even function, range (0, 1]; for |x| > ~710 `cosh` saturates to
//! infinity so the result is exactly 0 — never an error.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match coercion::eval_number(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(x) => Ok(Value::Number(1.0 / x.cosh())),
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
    fn sech_zero() {
        assert_eq!(n(&eval("=SECH(0)")), 1.0);
    }

    #[test]
    fn sech_one() {
        assert!((n(&eval("=SECH(1)")) - 0.6480542736638853).abs() < 1e-14);
    }

    #[test]
    fn sech_neg_three() {
        assert!((n(&eval("=SECH(-3)")) - 0.0993279274194332).abs() < 1e-14);
    }

    #[test]
    fn sech_even() {
        assert_eq!(n(&eval("=SECH(-2)")), n(&eval("=SECH(2)")));
    }

    #[test]
    fn sech_bounded() {
        let v = n(&eval("=SECH(5)"));
        assert!(v > 0.0 && v <= 1.0);
    }

    #[test]
    fn sech_large_arg_zero() {
        // cosh overflows to inf -> exactly 0, no error.
        assert_eq!(n(&eval("=SECH(1000)")), 0.0);
    }

    #[test]
    fn sech_text_coercion() {
        assert_eq!(n(&eval("=SECH(\"0\")")), 1.0);
    }

    #[test]
    fn sech_bad_text() {
        assert_eq!(e(&eval("=SECH(\"x\")")), CalcError::Value);
    }

    #[test]
    fn sech_error_propagates() {
        assert_eq!(e(&eval("=SECH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn sech_arity() {
        assert_eq!(e(&eval("=SECH()")), CalcError::Value);
        assert_eq!(e(&eval("=SECH(1,2)")), CalcError::Value);
    }
}
