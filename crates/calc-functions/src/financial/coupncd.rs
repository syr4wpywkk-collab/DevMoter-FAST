//! `COUPNCD(settlement, maturity, frequency, [basis])` — serial of the
//! first coupon date strictly after `settlement`. Spec:
//! `docs/functions/COUPNCD.md`.
//!
//! `basis` is validated but does not affect the result.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use super::coupon_args;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    match coupon_args(ctx, args, 3, 4, 3)? {
        Ok(a) => Ok(Value::Number(a.schedule.ncd as f64)),
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
    fn spec_example() {
        // NCD of 2007-01-25 against 2008-11-15 semiannual = 2007-05-15.
        assert_eq!(
            n(&eval("=COUPNCD(DATE(2007,1,25),DATE(2008,11,15),2,1)")),
            39217.0
        );
    }

    #[test]
    fn settlement_on_coupon_date_nexts() {
        assert_eq!(
            n(&eval("=COUPNCD(DATE(2007,5,15),DATE(2008,11,15),2,1)")),
            39401.0
        );
    }

    #[test]
    fn quarterly() {
        assert_eq!(
            n(&eval("=COUPNCD(DATE(2007,1,25),DATE(2008,11,15),4,0)")),
            39128.0
        );
    }

    #[test]
    fn annual() {
        // NCD of 2007-01-25 vs 2008-11-15 annual = 2007-11-15.
        assert_eq!(
            n(&eval("=COUPNCD(DATE(2007,1,25),DATE(2008,11,15),1,0)")),
            39401.0
        );
    }

    #[test]
    fn basis_default_and_ignored() {
        assert_eq!(
            n(&eval("=COUPNCD(DATE(2007,1,25),DATE(2008,11,15),2)")),
            39217.0
        );
        assert_eq!(
            n(&eval("=COUPNCD(DATE(2007,1,25),DATE(2008,11,15),2,4)")),
            39217.0
        );
    }

    #[test]
    fn bad_basis_num() {
        assert_eq!(
            e(&eval("=COUPNCD(DATE(2007,1,25),DATE(2008,11,15),2,5)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=COUPNCD(DATE(2007,1,25),DATE(2008,11,15),2,-1)")),
            CalcError::Num
        );
    }

    #[test]
    fn bad_frequency_num() {
        assert_eq!(
            e(&eval("=COUPNCD(DATE(2007,1,25),DATE(2008,11,15),3,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn settlement_ge_maturity_num() {
        assert_eq!(
            e(&eval("=COUPNCD(DATE(2008,11,15),DATE(2008,11,15),2,1)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=COUPNCD(DATE(2009,1,1),DATE(2008,11,15),2,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn maturity_is_ncd() {
        // Settlement in the last period -> NCD is maturity itself.
        assert_eq!(
            n(&eval("=COUPNCD(DATE(2008,6,1),DATE(2008,11,15),2,1)")),
            n(&eval("=DATE(2008,11,15)"))
        );
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(r#"=COUPNCD(DATE(2007,1,25),"x",2,1)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=COUPNCD(DATE(2007,1,25),1/0,2,1)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COUPNCD(1,2)")), CalcError::Value);
        assert_eq!(e(&eval("=COUPNCD(1,2,3,4,5)")), CalcError::Value);
    }
}
