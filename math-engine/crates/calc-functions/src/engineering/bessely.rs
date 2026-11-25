//! `BESSELY(x, n)` — Bessel function of the second kind, Y_n(x).
//! Spec: `docs/functions/BESSELY.md`. Kernel: [`crate::common::numerics::bessel_y`].

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
    Ok(bessel_value(numerics::bessel_y(n, x)))
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
        close(&eval("=BESSELY(2.5,1)"), 0.1459181380);
        close(&eval("=BESSELY(1,0)"), 0.0882569642);
        close(&eval("=BESSELY(10,0)"), 0.0556711673);
    }

    #[test]
    fn nonpositive_x_num() {
        assert_eq!(e(&eval("=BESSELY(-1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=BESSELY(0,0)")), CalcError::Num);
    }

    #[test]
    fn negative_order_num() {
        assert_eq!(e(&eval("=BESSELY(1,-1)")), CalcError::Num);
    }

    #[test]
    fn order_truncates() {
        close(&eval("=BESSELY(2.5,1.9)"), 0.1459181380);
    }

    #[test]
    fn higher_orders() {
        close(&eval("=BESSELY(2.5,2)"), -0.3813358492);
        close(&eval("=BESSELY(1,1)"), -0.7812128213);
    }

    #[test]
    fn large_x() {
        close(&eval("=BESSELY(20,1)"), -0.1655116144);
    }

    #[test]
    fn small_x_negative_divergence() {
        // Y_0 -> -inf as x -> 0+; returns a large finite magnitude.
        let g = n(&eval("=BESSELY(0.1,0)"));
        assert!(g < -1.0 && g.is_finite(), "got {g}");
    }

    #[test]
    fn text_coerces() {
        close(&eval(r#"=BESSELY("2.5","1")"#), 0.1459181380);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=BESSELY("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=BESSELY(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero_num() {
        assert_eq!(e(&eval("=BESSELY(A1,0)")), CalcError::Num);
        close(&eval("=BESSELY(1,A1)"), 0.0882569642);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BESSELY(1/0,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BESSELY(1)")), CalcError::Value);
        assert_eq!(e(&eval("=BESSELY(1,2,3)")), CalcError::Value);
    }
}
