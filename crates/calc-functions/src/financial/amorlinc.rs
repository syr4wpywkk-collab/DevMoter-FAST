//! `AMORLINC(cost, date_purchased, first_period, salvage, period, rate,
//! [basis])` — French straight-line depreciation prorated for the first
//! partial period. Spec: `docs/functions/AMORLINC.md`.
//!
//! Mirrors the reference (LibreOffice `GetAmorlinc`, matching Excel's
//! ATP behavior):
//! - period 0: `cost * rate * YEARFRAC(purchased, first_period, basis)`
//!   (unrounded);
//! - periods `1..=N`: `cost * rate` where
//!   `N = floor((cost - salvage - dep0) / (cost*rate))`;
//! - period `N+1`: the remainder `cost - salvage - N*cost*rate - dep0`;
//! - later periods: `0`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use crate::common::finance;

use super::amor_args;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let a = match amor_args(ctx, args)? {
        Ok(a) => a,
        Err(e) => return Ok(Value::Error(e)),
    };
    let yf = match finance::year_fraction(a.purchased, a.first_period, a.basis, a.system) {
        Some(yf) => yf,
        None => return Ok(Value::Error(calc_core::error::CalcError::Num)),
    };
    let one_rate = a.cost * a.rate;
    let dep0 = yf * one_rate;
    let full_periods = ((a.cost - a.salvage - dep0) / one_rate).max(0.0) as i64;
    let result = if a.period == 0 {
        dep0
    } else if a.period <= full_periods {
        one_rate
    } else if a.period == full_periods + 1 {
        a.cost - a.salvage - one_rate * full_periods as f64 - dep0
    } else {
        0.0
    };
    Ok(Value::Number(result.max(0.0)))
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
    fn spec_examples() {
        // Full-year charge: 2400 * 15% = 360.
        assert_eq!(
            n(&eval(
                "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)"
            )),
            360.0
        );
        // Period 0 prorated: 134 days / 366 (leap 2008) * 360 ~ 131.8.
        let d0 = n(&eval(
            "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,0,0.15,1)",
        ));
        assert!((d0 - 360.0 * 134.0 / 366.0).abs() < 1e-6);
        // Terminal partial period: remainder.
        let d6 = n(&eval(
            "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,6,0.15,1)",
        ));
        assert!((d6 - (2100.0 - 5.0 * 360.0 - d0)).abs() < 1e-6);
    }

    #[test]
    fn beyond_life_zero() {
        assert_eq!(
            n(&eval(
                "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,7,0.15,1)"
            )),
            0.0
        );
        assert_eq!(
            n(&eval(
                "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,100,0.15,1)"
            )),
            0.0
        );
    }

    #[test]
    fn period_truncates() {
        assert_eq!(
            n(&eval(
                "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1.9,0.15,1)"
            )),
            360.0
        );
    }

    #[test]
    fn basis_default_zero() {
        // Basis 0: 30/360 days 8/19->12/31 = 132, /360.
        let d0 = n(&eval(
            "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,0,0.15)",
        ));
        assert!((d0 - 360.0 * 132.0 / 360.0).abs() < 1e-6);
    }

    #[test]
    fn invalid_inputs_num() {
        assert_eq!(
            e(&eval(
                "=AMORLINC(2400,DATE(2008,12,31),DATE(2008,8,19),300,1,0.15,1)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0,1)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),2500,1,0.15,1)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=AMORLINC(0,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),-1,1,0.15,1)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,-1,0.15,1)"
            )),
            CalcError::Num
        );
    }

    #[test]
    fn bad_basis_num() {
        assert_eq!(
            e(&eval(
                "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,5)"
            )),
            CalcError::Num
        );
    }

    #[test]
    fn salvage_equal_cost_zero() {
        assert_eq!(
            n(&eval(
                "=AMORLINC(2400,DATE(2008,8,19),DATE(2008,12,31),2400,1,0.15,1)"
            )),
            0.0
        );
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(
                r#"=AMORLINC("x",DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)"#
            )),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval(
                "=AMORLINC(1/0,DATE(2008,8,19),DATE(2008,12,31),300,1,0.15,1)"
            )),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=AMORLINC(1,2,3,4,5)")), CalcError::Value);
        assert_eq!(e(&eval("=AMORLINC(1,2,3,4,5,6,7,8)")), CalcError::Value);
    }
}
