//! `BESSELI(x, n)` — modified Bessel function of the first kind, I_n(x).
//! Spec: `docs/functions/BESSELI.md`. Kernel: [`crate::common::numerics::bessel_i`].

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::numerics;

/// Shared `(x, n)` argument evaluation for the `BESSEL{I,J,K,Y}`
/// family: both coerce via [`Value::to_number`]; `n` is truncated
/// toward zero and `n < 0` -> `#NUM!` (per spec).
pub(crate) fn eval_xn(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Result<Result<(f64, i64), CalcError>, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Err(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Err(e)),
    };
    let n = match ctx.eval(&args[1])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Err(e)),
    };
    let nt = n.trunc();
    if nt < 0.0 || nt > i64::MAX as f64 {
        return Ok(Err(CalcError::Num));
    }
    Ok(Ok((x, nt as i64)))
}

/// Map a kernel result to a `Value`: `NaN` or non-finite -> `#NUM!`
/// (I_n grows like `e^x`; the overflow boundary is SPEC-OPEN).
pub(crate) fn bessel_value(v: f64) -> Value {
    if v.is_finite() {
        Value::Number(v)
    } else {
        Value::Error(CalcError::Num)
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    match eval_xn(ctx, args)? {
        Err(e) => Ok(Value::Error(e)),
        Ok((x, n)) => Ok(bessel_value(numerics::bessel_i(n, x))),
    }
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
        // SPEC-OPEN: the spec doc's 1.646723 is wrong — I_1(1.5) is
        // 0.9816664286 (mpmath/scipy; Excel's own low-precision result
        // agrees). Kept the true value.
        close(&eval("=BESSELI(1.5,1)"), 0.9816664286);
        close(&eval("=BESSELI(0,0)"), 1.0);
        close(&eval("=BESSELI(2,0)"), 2.2795853023);
    }

    #[test]
    fn order_truncates() {
        // n = 1.9 truncates to 1 (documented Excel behavior).
        close(&eval("=BESSELI(1.5,1.9)"), 0.9816664286);
    }

    #[test]
    fn negative_order_num() {
        assert_eq!(e(&eval("=BESSELI(1.5,-1)")), CalcError::Num);
    }

    #[test]
    fn negative_x_parity() {
        // I_n(-x) = (-1)^n I_n(x) (SPEC-OPEN: confirm Excel parity).
        close(&eval("=BESSELI(-2,0)"), 2.2795853023);
        close(&eval("=BESSELI(-1.5,1)"), -0.9816664286);
        close(&eval("=BESSELI(-1.5,2)"), 0.3378346183);
    }

    #[test]
    fn higher_orders() {
        close(&eval("=BESSELI(2,2)"), 0.6889484477);
        close(&eval("=BESSELI(5,3)"), 10.3311501692);
        close(&eval("=BESSELI(1,5)"), 0.0002714632);
    }

    #[test]
    fn zero_x() {
        close(&eval("=BESSELI(0,3)"), 0.0);
    }

    #[test]
    fn large_x() {
        close(&eval("=BESSELI(20,0)"), 43558282.5596);
    }

    #[test]
    fn text_coerces() {
        close(&eval(r#"=BESSELI("1.5","1")"#), 0.9816664286);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=BESSELI("x",1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=BESSELI(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn blank_ref_is_zero() {
        // Blank x -> 0, I_0(0) = 1; blank n -> 0.
        close(&eval("=BESSELI(A1,0)"), 1.0);
        close(&eval("=BESSELI(2,A1)"), 2.2795853023);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=BESSELI(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval("=BESSELI(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BESSELI(1)")), CalcError::Value);
        assert_eq!(e(&eval("=BESSELI(1,2,3)")), CalcError::Value);
    }
}
