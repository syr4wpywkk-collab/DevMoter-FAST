//! `IMARGUMENT(inumber)` — argument `atan2(y, x)` of a complex number,
//! in radians, `(-pi, pi]`. `0+0i` -> `#DIV/0!` (documented).
//! Spec: `docs/functions/IMARGUMENT.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::engineering::imaginary::{complex_err, eval_inumber};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let z = match eval_inumber(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok((z, _)) => z,
    };
    match z.arg() {
        Ok(theta) => Ok(Value::Number(theta)),
        // IMARGUMENT.md documents #DIV/0! at the origin.
        Err(e) => Ok(Value::Error(complex_err(e, CalcError::DivZero))),
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

    fn a(v: &Value, x: f64) {
        let got = n(v);
        assert!(
            (got - x).abs() <= 1e-12 * x.abs().max(1.0),
            "got {got}, want {x}"
        );
    }

    #[test]
    fn spec_examples() {
        a(&eval(r#"=IMARGUMENT("0+1i")"#), std::f64::consts::FRAC_PI_2);
        a(&eval(r#"=IMARGUMENT("3+4i")"#), 0.9272952180016122);
        a(&eval(r#"=IMARGUMENT("-1")"#), std::f64::consts::PI);
        assert_eq!(e(&eval(r#"=IMARGUMENT("0")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=IMARGUMENT("oops")"#)), CalcError::Num);
    }

    #[test]
    fn negative_imaginary_axis() {
        a(
            &eval(r#"=IMARGUMENT("0-1i")"#),
            -std::f64::consts::FRAC_PI_2,
        );
    }

    #[test]
    fn below_negative_real_axis() {
        // Principal branch: just below the axis -> -pi.
        a(
            &eval(r#"=IMARGUMENT("-1-0.0001i")"#),
            -std::f64::consts::PI + 0.0001_f64.atan(),
        );
    }

    #[test]
    fn positive_real_zero() {
        assert_eq!(n(&eval(r#"=IMARGUMENT("5")"#)), 0.0);
    }

    #[test]
    fn real_number_arg() {
        a(&eval("=IMARGUMENT(-4)"), std::f64::consts::PI);
    }

    #[test]
    fn zero_im_zero_div0() {
        assert_eq!(e(&eval(r#"=IMARGUMENT("0i")"#)), CalcError::DivZero);
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMARGUMENT(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_num() {
        assert_eq!(e(&eval("=IMARGUMENT(A1)")), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMARGUMENT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMARGUMENT()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMARGUMENT("1","2")"#)), CalcError::Value);
    }
}
