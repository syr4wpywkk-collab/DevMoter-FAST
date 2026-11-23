//! `BESSELK(x, n)` — modified Bessel function of the second kind, K_n(x).
//! Spec: `docs/functions/BESSELK.md`. Kernel: [`crate::common::numerics::bessel_k`].

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use crate::common::numerics;
use crate::engineering::besseli::{bessel_value, eval_xn};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let (x, n) = match eval_xn(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if x <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(bessel_value(numerics::bessel_k(n, x)))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    const TOL: f64 = 5e-7;

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
            (g - want).abs() <= TOL.max(want.abs() * TOL),
            "got {g}, want {want}"
        );
    }

    #[test]
    fn spec_examples() {
        close(&eval("=BESSELK(1.5,1)"), 0.2773878045);
        close(&eval("=BESSELK(2,0)"), 0.1138938938);
        // SPEC-OPEN: the spec doc's 0.601907 for K_0(1) is wrong — the
        // true value is 0.4210244382 (mpmath/scipy).
        close(&eval("=BESSELK(1,0)"), 0.4210244382);
    }

    #[test]
    fn nonpositive_x_num() {
        assert_eq!(e(&eval("=BESSELK(0,1)")), CalcError::Num);
        assert_eq!(e(&eval("=BESSELK(-1,0)")), CalcError::Num);
    }

    #[test]
    fn negative_order_num() {
        assert_eq!(e(&eval("=BESSELK(1,-1)")), CalcError::Num);
    }

    #[test]
    fn order_truncates() {
        close(&eval("=BESSELK(1.5,1.9)"), 0.2773878045);
    }

    #[test]
    fn higher_orders() {
        close(&eval("=BESSELK(1.5,2)"), 0.5836559633);
        close(&eval("=BESSELK(3,4)"), 0.3058512100);
    }

    #[test]
    fn large_x_decay() {
        close(&eval("=BESSELK(10,0)"), 1.7780062e-5);
    }

    #[test]
    fn small_x_divergence() {
        close(&eval("=BESSELK(0.1,0)"), 2.4270690247);
    }

    #[test]
    fn text_coerces() {
        close(&eval(r#"=BESSELK("1.5","1")"#), 0.2773878045);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=BESSELK("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=BESSELK(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero_num() {
        // Blank x -> 0 -> #NUM! (x must be positive).
        assert_eq!(e(&eval("=BESSELK(A1,1)")), CalcError::Num);
        // Blank n -> 0.
        close(&eval("=BESSELK(2,A1)"), 0.1138938938);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BESSELK(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BESSELK(1)")), CalcError::Value);
        assert_eq!(e(&eval("=BESSELK(1,2,3)")), CalcError::Value);
    }
}
