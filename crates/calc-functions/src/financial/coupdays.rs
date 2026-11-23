//! `COUPDAYS(settlement, maturity, frequency, [basis])` — days in the
//! coupon period containing `settlement`. Spec:
//! `docs/functions/COUPDAYS.md`.
//!
//! `360/frequency` for bases 0/2/4, `365/frequency` for basis 3
//! (fractional for frequency 2/4 — Excel's truncation is SPEC-OPEN),
//! actual `pcd -> ncd` days for basis 1.

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
    match finance::coupon_period_days(
        a.basis,
        a.frequency,
        a.schedule.pcd,
        a.schedule.ncd,
        a.system,
    ) {
        Some(d) => Ok(Value::Number(d)),
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
        // Period 2006-11-15 -> 2007-05-15 is 181 actual days.
        assert_eq!(
            n(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2,1)")),
            181.0
        );
        assert_eq!(
            n(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2,0)")),
            180.0
        );
        assert_eq!(
            n(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),4,0)")),
            90.0
        );
        assert_eq!(
            n(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2,3)")),
            182.5
        );
    }

    #[test]
    fn annual_360() {
        assert_eq!(
            n(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),1,0)")),
            360.0
        );
    }

    #[test]
    fn basis2_and_4() {
        assert_eq!(
            n(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2,2)")),
            180.0
        );
        assert_eq!(
            n(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2,4)")),
            180.0
        );
    }

    #[test]
    fn basis1_quarterly_actual() {
        // 2006-11-15 -> 2007-02-15 = 92 actual days.
        assert_eq!(
            n(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),4,1)")),
            92.0
        );
    }

    #[test]
    fn basis_default_zero() {
        assert_eq!(
            n(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2)")),
            180.0
        );
    }

    #[test]
    fn settlement_ge_maturity_num() {
        assert_eq!(
            e(&eval("=COUPDAYS(DATE(2008,11,15),DATE(2008,11,15),2,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn bad_frequency_num() {
        assert_eq!(
            e(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),3,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn bad_basis_num() {
        assert_eq!(
            e(&eval("=COUPDAYS(DATE(2007,1,25),DATE(2008,11,15),2,-1)")),
            CalcError::Num
        );
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(r#"=COUPDAYS("x",DATE(2008,11,15),2,1)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=COUPDAYS(DATE(2007,1,25),1/0,2,1)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COUPDAYS(1,2)")), CalcError::Value);
    }
}
