//! `PV(rate, nper, pmt, [fv], [type])` — present value of an annuity
//! with constant payment `pmt`. Spec: `docs/functions/PV.md`.
//!
//! Closed form via [`finance::annuity_pv`]; `type != 0` means payments
//! at the beginning of each period. `rate == -1` makes the discount
//! factor `(1+r)^(-n)` undefined — reported as `#NUM!` (SPEC-OPEN:
//! Excel's exact error class for `rate <= -1` is unconfirmed;
//! `rate < -1` is left algebraic like Excel).

use crate::common::finance;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::{arg_num, opt_num};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 5) {
        return Ok(Value::Error(e));
    }
    let rate = match arg_num(ctx, args, 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let nper = match arg_num(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let pmt = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let fv = match opt_num(ctx, args, 3, 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let typ = match opt_num(ctx, args, 4, 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let pv = finance::annuity_pv(rate, nper, pmt, fv, typ);
    if !pv.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(pv))
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

    fn near(v: &Value, want: f64) {
        let got = n(v);
        assert!((got - want).abs() < 1e-4, "got {got}, want ~{want}");
    }

    #[test]
    fn spec_example_monthly() {
        // PV(0.005, 36, -100) = 100*(1 - 1.005^-36)/0.005 ≈ 3287.10.
        near(&eval("=PV(0.005,36,-100)"), 3287.1016);
    }

    #[test]
    fn zero_rate_linear() {
        assert_eq!(n(&eval("=PV(0,10,-100)")), 1000.0);
    }

    #[test]
    fn single_period() {
        // Excel: PV(10%, 1, -100) = 90.909...
        near(&eval("=PV(0.1,1,-100)"), 90.9090909);
    }

    #[test]
    fn type_one_beginning() {
        near(&eval("=PV(0.08,20,-500,0,1)"), 5301.7996);
    }

    #[test]
    fn with_fv() {
        // PV(0.1, 10, 0, -1000) = 1000/1.1^10 ≈ 385.54.
        near(&eval("=PV(0.1,10,0,-1000)"), 385.5433);
    }

    #[test]
    fn fv_and_pmt() {
        // PV(0.05,10,-100,500) = 100*annuity - 500*1.05^-10.
        let want = 100.0 * (1.0 - 1.05f64.powi(-10)) / 0.05 - 500.0 * 1.05f64.powi(-10);
        near(&eval("=PV(0.05,10,-100,500)"), want);
    }

    #[test]
    fn missing_optional_defaults() {
        assert_eq!(n(&eval("=PV(0,10,-100,,)")), n(&eval("=PV(0,10,-100,0,0)")));
    }

    #[test]
    fn rate_minus_one_num() {
        // SPEC-OPEN: Excel's error class for rate <= -1 unconfirmed.
        assert_eq!(e(&eval("=PV(-1,5,-100)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(e(&eval(r#"=PV("x",10,-100)"#)), CalcError::Value);
    }

    #[test]
    fn text_number_coerces() {
        near(&eval(r#"=PV("0.1",1,-100)"#), 90.9090909);
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=PV(A1,10,-100)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn sign_convention() {
        // Positive pmt -> negative PV (cash in/out convention).
        assert!(n(&eval("=PV(0.05,10,100)")) < 0.0);
    }
}
