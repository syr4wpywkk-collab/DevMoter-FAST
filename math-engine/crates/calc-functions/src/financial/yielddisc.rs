//! `YIELDDISC(settlement, maturity, pr, redemption, [basis])` —
//! annual yield of a discounted (non-coupon) security:
//! `(redemption - pr) / pr / yearfrac(settlement, maturity, basis)`.
//! Spec: `docs/functions/YIELDDISC.md`.
//!
//! Closed form. `pr > redemption` (negative yield) passes through —
//! the documented bounds are only `pr <= 0` / `redemption <= 0`
//! (SPEC-OPEN: whether Excel errors on deeply negative yields).

use crate::common::finance;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::{arg_basis, arg_date, arg_num};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 5) {
        return Ok(Value::Error(e));
    }
    let settlement = match arg_date(ctx, args, 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let maturity = match arg_date(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let pr = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let redemption = match arg_num(ctx, args, 3)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let basis = match arg_basis(ctx, args, 4)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if settlement >= maturity || pr <= 0.0 || redemption <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    match finance::year_fraction(settlement, maturity, basis, ctx.date_system()) {
        Some(yf) => Ok(Value::Number((redemption - pr) / pr / yf)),
        None => Ok(Value::Error(CalcError::Num)),
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
    fn spec_act365() {
        // (1.25/98.75) * 365/90 = 0.051335...
        let got = n(&eval("=YIELDDISC(45000,45090,98.75,100,3)"));
        assert!((got - 0.0513354).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn spec_us30360() {
        // (10/90) * 360/354 = 0.112994.
        let got = n(&eval("=YIELDDISC(45000,45360,90,100,0)"));
        assert!((got - 0.1129944).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn basis_act360() {
        // (10/90) * 360/360.
        let got = n(&eval("=YIELDDISC(45000,45360,90,100,2)"));
        assert!((got - 0.1111111).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn negative_yield_passes() {
        // pr > redemption -> negative yield (documented bound is <= 0
        // only). (80-100)/100 * 360/176.
        let got = n(&eval("=YIELDDISC(45000,45180,100,80,0)"));
        assert!((got - (-0.4090909)).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn dates_equal_num() {
        assert_eq!(e(&eval("=YIELDDISC(45000,45000,98,100)")), CalcError::Num);
    }

    #[test]
    fn dates_inverted_num() {
        assert_eq!(e(&eval("=YIELDDISC(45180,45000,98,100)")), CalcError::Num);
    }

    #[test]
    fn pr_zero_num() {
        assert_eq!(e(&eval("=YIELDDISC(45000,45180,0,100)")), CalcError::Num);
    }

    #[test]
    fn redemption_negative_num() {
        assert_eq!(e(&eval("=YIELDDISC(45000,45180,98,-100)")), CalcError::Num);
    }

    #[test]
    fn basis_out_of_range_num() {
        assert_eq!(e(&eval("=YIELDDISC(45000,45180,98,100,7)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(
            e(&eval(r#"=YIELDDISC(45000,45180,98,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn default_basis_zero() {
        assert_eq!(
            n(&eval("=YIELDDISC(45000,45360,90,100)")),
            n(&eval("=YIELDDISC(45000,45360,90,100,0)"))
        );
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=YIELDDISC(45000,45180,A1,100)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
