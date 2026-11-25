//! `BESSELJ(x, n)` — Bessel function of the first kind, J_n(x).
//! Spec: `docs/functions/BESSELJ.md`. Kernel: [`crate::common::numerics::bessel_j`].

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use crate::common::numerics;
use crate::engineering::besseli::{bessel_value, eval_xn};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    match eval_xn(ctx, args)? {
        Err(e) => Ok(Value::Error(e)),
        Ok((x, n)) => Ok(bessel_value(numerics::bessel_j(n, x))),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    const TOL: f64 = 1e-9;

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

    fn close(got: &Value, want: f64) {
        let g = n(got);
        assert!(
            (g - want).abs() <= TOL.max(want.abs() * 1e-7),
            "got {g}, want {want}"
        );
    }

    #[test]
    fn spec_examples() {
        close(&eval("=BESSELJ(1.9,2)"), 0.3299258287);
        close(&eval("=BESSELJ(0,0)"), 1.0);
        close(&eval("=BESSELJ(5,0)"), -0.1775967713);
    }

    #[test]
    fn order_truncates() {
        close(&eval("=BESSELJ(1.9,2.9)"), 0.3299258287);
    }

    #[test]
    fn negative_order_num() {
        assert_eq!(e(&eval("=BESSELJ(1,-2)")), CalcError::Num);
    }

    #[test]
    fn negative_x_parity() {
        // J_n(-x) = (-1)^n J_n(x) (SPEC-OPEN: confirm).
        close(&eval("=BESSELJ(-1.9,2)"), 0.3299258287);
        close(&eval("=BESSELJ(-1.9,3)"), -0.1134234066);
    }

    #[test]
    fn order_one() {
        close(&eval("=BESSELJ(2,1)"), 0.5767248078);
    }

    #[test]
    fn large_x_decay() {
        close(&eval("=BESSELJ(20,0)"), 0.1670246643);
        close(&eval("=BESSELJ(10,1)"), 0.0434727462);
    }

    #[test]
    fn high_order_small_x() {
        close(&eval("=BESSELJ(1,5)"), 0.0002497577);
    }

    #[test]
    fn order_exceeding_x() {
        // n > x exercises the Miller downward-recurrence branch.
        close(&eval("=BESSELJ(2,10)"), 0.0000002515386283);
        close(&eval("=BESSELJ(1,8)"), 0.0000000942234417);
    }

    #[test]
    fn text_coerces() {
        close(&eval(r#"=BESSELJ("1.9","2")"#), 0.3299258287);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=BESSELJ("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=BESSELJ(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        close(&eval("=BESSELJ(A1,0)"), 1.0);
        close(&eval("=BESSELJ(A1,2)"), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BESSELJ(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BESSELJ(1)")), CalcError::Value);
        assert_eq!(e(&eval("=BESSELJ(1,2,3)")), CalcError::Value);
    }
}
