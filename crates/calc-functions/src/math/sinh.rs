//! `SINH(number)` — hyperbolic sine. Spec: `docs/functions/SINH.md`.
//!
//! |x| > ~710 overflows f64; per the shared `EXP` overflow policy the
//! result maps to `#NUM!` (SPEC-OPEN: `#NUM!` vs infinity).

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
        Ok(x) => {
            let v = x.sinh();
            if v.is_finite() {
                Ok(Value::Number(v))
            } else {
                Ok(Value::Error(CalcError::Num))
            }
        }
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
    fn sinh_zero() {
        assert_eq!(n(&eval("=SINH(0)")), 0.0);
    }

    #[test]
    fn sinh_one() {
        assert_eq!(n(&eval("=SINH(1)")), 1.1752011936438014);
    }

    #[test]
    fn sinh_neg_one() {
        assert_eq!(n(&eval("=SINH(-1)")), -1.1752011936438014);
    }

    #[test]
    fn sinh_odd() {
        assert_eq!(n(&eval("=SINH(-2)")), -n(&eval("=SINH(2)")));
    }

    #[test]
    fn sinh_three() {
        assert!((n(&eval("=SINH(3)")) - 10.017874927409903).abs() < 1e-12);
    }

    #[test]
    fn sinh_overflow_num() {
        assert_eq!(e(&eval("=SINH(1000)")), CalcError::Num);
    }

    #[test]
    fn sinh_neg_overflow_num() {
        assert_eq!(e(&eval("=SINH(-1000)")), CalcError::Num);
    }

    #[test]
    fn sinh_text_coercion() {
        assert_eq!(n(&eval("=SINH(\"0\")")), 0.0);
    }

    #[test]
    fn sinh_bad_text() {
        assert_eq!(e(&eval("=SINH(\"x\")")), CalcError::Value);
    }

    #[test]
    fn sinh_error_propagates() {
        assert_eq!(e(&eval("=SINH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn sinh_arity() {
        assert_eq!(e(&eval("=SINH()")), CalcError::Value);
        assert_eq!(e(&eval("=SINH(1,2)")), CalcError::Value);
    }
}
