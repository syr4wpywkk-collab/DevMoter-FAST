//! `COUPPCD(settlement, maturity, frequency, [basis])` — serial of the
//! last coupon date on or before `settlement`. Spec:
//! `docs/functions/COUPPCD.md`.
//!
//! `basis` is validated but does not affect the result: coupon dates
//! are calendar dates on the schedule anchored at `maturity`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use super::coupon_args;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    match coupon_args(ctx, args, 3, 4, 3)? {
        Ok(a) => Ok(Value::Number(a.schedule.pcd as f64)),
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
        // PCD of 2007-01-25 against 2008-11-15 semiannual = 2006-11-15.
        assert_eq!(
            n(&eval("=COUPPCD(DATE(2007,1,25),DATE(2008,11,15),2,1)")),
            39036.0
        );
    }

    #[test]
    fn settlement_on_coupon_date() {
        assert_eq!(
            n(&eval("=COUPPCD(DATE(2007,5,15),DATE(2008,11,15),2,1)")),
            39217.0
        );
    }

    #[test]
    fn quarterly_same_pcd() {
        assert_eq!(
            n(&eval("=COUPPCD(DATE(2007,1,25),DATE(2008,11,15),4,0)")),
            39036.0
        );
    }

    #[test]
    fn basis_ignored_but_validated() {
        assert_eq!(
            n(&eval("=COUPPCD(DATE(2007,1,25),DATE(2008,11,15),2,3)")),
            39036.0
        );
        assert_eq!(
            e(&eval("=COUPPCD(DATE(2007,1,25),DATE(2008,11,15),2,9)")),
            CalcError::Num
        );
    }

    #[test]
    fn basis_default_zero() {
        assert_eq!(
            n(&eval("=COUPPCD(DATE(2007,1,25),DATE(2008,11,15),2)")),
            39036.0
        );
    }

    #[test]
    fn bad_frequency() {
        assert_eq!(
            e(&eval("=COUPPCD(DATE(2007,1,25),DATE(2008,11,15),5,1)")),
            CalcError::Num
        );
        // Frequency truncates: 2.9 -> 2 (valid).
        assert_eq!(
            n(&eval("=COUPPCD(DATE(2007,1,25),DATE(2008,11,15),2.9,1)")),
            39036.0
        );
        assert_eq!(
            e(&eval("=COUPPCD(DATE(2007,1,25),DATE(2008,11,15),0,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn settlement_after_maturity_num() {
        assert_eq!(
            e(&eval("=COUPPCD(DATE(2008,11,16),DATE(2008,11,15),2,1)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=COUPPCD(DATE(2008,11,15),DATE(2008,11,15),2,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn dates_truncated() {
        assert_eq!(
            n(&eval("=COUPPCD(DATE(2007,1,25)+0.9,DATE(2008,11,15),2,1)")),
            39036.0
        );
    }

    #[test]
    fn negative_date_num() {
        assert_eq!(
            e(&eval("=COUPPCD(-1,DATE(2008,11,15),2,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn text_coerces_but_junk_is_value() {
        assert_eq!(n(&eval(r#"=COUPPCD("39107","39401",2,1)"#)), 39036.0);
        assert_eq!(
            e(&eval(r#"=COUPPCD("x",DATE(2008,11,15),2,1)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=COUPPCD(1/0,DATE(2008,11,15),2,1)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COUPPCD(1,2)")), CalcError::Value);
        assert_eq!(e(&eval("=COUPPCD(1,2,3,4,5)")), CalcError::Value);
    }
}
