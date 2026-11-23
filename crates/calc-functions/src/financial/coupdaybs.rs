//! `COUPDAYBS(settlement, maturity, frequency, [basis])` — days from
//! the beginning of the coupon period (the `COUPPCD` date) to
//! `settlement`, counted under `basis`. Spec:
//! `docs/functions/COUPDAYBS.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use crate::common::finance;

use super::coupon_args;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let a = match coupon_args(ctx, args, 3, 4, 3)? {
        Ok(a) => a,
        Err(e) => return Ok(Value::Error(e)),
    };
    match finance::days_between(a.schedule.pcd, a.settlement, a.basis, a.system) {
        Some(d) => Ok(Value::Number(d as f64)),
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
    fn spec_examples() {
        // PCD 2006-11-15 -> 2007-01-25: 71 actual days, 70 under 30/360.
        assert_eq!(
            n(&eval("=COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),2,1)")),
            71.0
        );
        assert_eq!(
            n(&eval("=COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),2,0)")),
            70.0
        );
    }

    #[test]
    fn settlement_on_coupon_date_zero() {
        assert_eq!(
            n(&eval("=COUPDAYBS(DATE(2007,5,15),DATE(2008,11,15),2,1)")),
            0.0
        );
    }

    #[test]
    fn basis_360_365_eu() {
        assert_eq!(
            n(&eval("=COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),2,2)")),
            71.0
        );
        assert_eq!(
            n(&eval("=COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),2,3)")),
            71.0
        );
        assert_eq!(
            n(&eval("=COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),2,4)")),
            70.0
        );
    }

    #[test]
    fn basis_default_zero() {
        assert_eq!(
            n(&eval("=COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),2)")),
            70.0
        );
    }

    #[test]
    fn maturity_reversed_num() {
        assert_eq!(
            e(&eval("=COUPDAYBS(DATE(2008,11,15),DATE(2007,1,25),2,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn bad_frequency_and_basis_num() {
        assert_eq!(
            e(&eval("=COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),5,1)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),2,5)")),
            CalcError::Num
        );
    }

    #[test]
    fn day_after_pcd() {
        assert_eq!(
            n(&eval("=COUPDAYBS(DATE(2006,11,16),DATE(2008,11,15),2,1)")),
            1.0
        );
    }

    #[test]
    fn quarterly_schedule() {
        // PCD 2006-11-15 -> 2007-01-25 = 71 days (same period boundary).
        assert_eq!(
            n(&eval("=COUPDAYBS(DATE(2007,1,25),DATE(2008,11,15),4,1)")),
            71.0
        );
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(r#"=COUPDAYBS("x",DATE(2008,11,15),2,1)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=COUPDAYBS(1/0,DATE(2008,11,15),2,1)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COUPDAYBS(1,2)")), CalcError::Value);
        assert_eq!(e(&eval("=COUPDAYBS(1,2,3,4,5)")), CalcError::Value);
    }
}
