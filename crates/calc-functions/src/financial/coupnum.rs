//! `COUPNUM(settlement, maturity, frequency, [basis])` — count of
//! coupon dates strictly after `settlement` up to and including
//! `maturity`. Spec: `docs/functions/COUPNUM.md`.
//!
//! `basis` is validated but does not affect the result.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use super::coupon_args;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    match coupon_args(ctx, args, 3, 4, 3)? {
        Ok(a) => Ok(Value::Number(a.schedule.remaining as f64)),
        Err(e) => Ok(Value::Error(e)),
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
        assert_eq!(
            n(&eval("=COUPNUM(DATE(2007,1,25),DATE(2008,11,15),2,1)")),
            4.0
        );
        assert_eq!(
            n(&eval("=COUPNUM(DATE(2007,1,25),DATE(2009,11,15),2,1)")),
            6.0
        );
        assert_eq!(
            n(&eval("=COUPNUM(DATE(2007,1,25),DATE(2008,11,15),4,0)")),
            8.0
        );
    }

    #[test]
    fn annual() {
        assert_eq!(
            n(&eval("=COUPNUM(DATE(2007,1,25),DATE(2010,11,15),1,0)")),
            4.0
        );
    }

    #[test]
    fn settlement_on_coupon_date() {
        // PCD == settlement, so remaining coupons are unchanged vs the
        // day before.
        assert_eq!(
            n(&eval("=COUPNUM(DATE(2007,5,15),DATE(2008,11,15),2,1)")),
            3.0
        );
    }

    #[test]
    fn final_period_only() {
        assert_eq!(
            n(&eval("=COUPNUM(DATE(2008,11,14),DATE(2008,11,15),2,1)")),
            1.0
        );
    }

    #[test]
    fn basis_ignored() {
        assert_eq!(
            n(&eval("=COUPNUM(DATE(2007,1,25),DATE(2008,11,15),2)")),
            4.0
        );
        assert_eq!(
            e(&eval("=COUPNUM(DATE(2007,1,25),DATE(2008,11,15),2,9)")),
            CalcError::Num
        );
    }

    #[test]
    fn bad_frequency_num() {
        assert_eq!(
            e(&eval("=COUPNUM(DATE(2007,1,25),DATE(2008,11,15),0,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn settlement_ge_maturity_num() {
        assert_eq!(
            e(&eval("=COUPNUM(DATE(2008,11,15),DATE(2008,11,15),2,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(r#"=COUPNUM(DATE(2007,1,25),DATE(2008,11,15),"x",1)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=COUPNUM(1/0,DATE(2008,11,15),2,1)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COUPNUM(1,2)")), CalcError::Value);
    }
}
