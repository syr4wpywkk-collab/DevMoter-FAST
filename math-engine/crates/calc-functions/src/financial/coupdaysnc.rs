//! `COUPDAYSNC(settlement, maturity, frequency, [basis])` — days from
//! `settlement` to the next coupon date (`COUPNCD`), counted under
//! `basis`. Spec: `docs/functions/COUPDAYSNC.md`.

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
    match finance::days_between(a.settlement, a.schedule.ncd, a.basis, a.system) {
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
        // 2007-01-25 -> NCD 2007-05-15: 110 days (actual and 30/360).
        assert_eq!(
            n(&eval("=COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),2,1)")),
            110.0
        );
        assert_eq!(
            n(&eval("=COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),2,0)")),
            110.0
        );
        // Settlement on a coupon date: counts into the next period.
        assert_eq!(
            n(&eval("=COUPDAYSNC(DATE(2007,5,15),DATE(2008,11,15),2,1)")),
            184.0
        );
        assert_eq!(
            e(&eval("=COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),5,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn basis_default_zero() {
        assert_eq!(
            n(&eval("=COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),2)")),
            110.0
        );
    }

    #[test]
    fn eu_30360() {
        assert_eq!(
            n(&eval("=COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),2,4)")),
            110.0
        );
    }

    #[test]
    fn settlement_ge_maturity_num() {
        assert_eq!(
            e(&eval("=COUPDAYSNC(DATE(2008,11,15),DATE(2008,11,15),2,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn bad_basis_num() {
        assert_eq!(
            e(&eval("=COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),2,7)")),
            CalcError::Num
        );
    }

    #[test]
    fn day_before_ncd() {
        assert_eq!(
            n(&eval("=COUPDAYSNC(DATE(2007,5,14),DATE(2008,11,15),2,1)")),
            1.0
        );
    }

    #[test]
    fn quarterly() {
        // 2007-01-25 -> 2007-02-15 = 21 actual days.
        assert_eq!(
            n(&eval("=COUPDAYSNC(DATE(2007,1,25),DATE(2008,11,15),4,1)")),
            21.0
        );
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(r#"=COUPDAYSNC(DATE(2007,1,25),"x",2,1)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=COUPDAYSNC(DATE(2007,1,25),1/0,2,1)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COUPDAYSNC(1,2)")), CalcError::Value);
        assert_eq!(e(&eval("=COUPDAYSNC(1,2,3,4,5)")), CalcError::Value);
    }
}
