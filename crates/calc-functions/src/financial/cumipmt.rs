//! `CUMIPMT(rate, nper, pv, start_period, end_period, type)` —
//! cumulative interest paid over the inclusive 1-based period range.
//! Spec: `docs/functions/CUMIPMT.md`.
//!
//! `Σ IPMT(rate, per, nper, pv, 0, type)` — see [`super::ipmt`] for the
//! per-period interest convention (type 1 charges interest on the
//! balance after the beginning-of-period payment).

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

use crate::common::finance;

use super::{cum_args, ipmt};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let a = match cum_args(ctx, args)? {
        Ok(a) => a,
        Err(e) => return Ok(Value::Error(e)),
    };
    let pmt = finance::annuity_pmt(a.rate, a.nper as f64, a.pv, 0.0, a.typ as f64);
    let total: f64 = (a.start..=a.end)
        .map(|per| ipmt(a.rate, per, a.pv, pmt, a.typ))
        .sum();
    Ok(Value::Number(total))
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
        assert!((n(&eval("=CUMIPMT(0.09/12,360,125000,13,24,0)")) - -11135.23213).abs() < 1e-4);
        assert_eq!(n(&eval("=CUMIPMT(0.09/12,360,125000,1,1,0)")), -937.5);
        assert!((n(&eval("=CUMIPMT(0.09/12,360,125000,13,24,1)")) - -11128.22633).abs() < 1e-4);
        assert_eq!(
            e(&eval("=CUMIPMT(0.09/12,360,125000,24,13,0)")),
            CalcError::Num
        );
    }

    #[test]
    fn invariant_with_cumprinc() {
        // CUMIPMT + CUMPRINC over 1..nper = nper * PMT.
        let i = n(&eval("=CUMIPMT(0.09/12,360,125000,1,360,0)"));
        let p = n(&eval("=CUMPRINC(0.09/12,360,125000,1,360,0)"));
        assert!((i + p - -362_080.17).abs() < 0.5);
    }

    #[test]
    fn rate_zero_and_negative_num() {
        assert_eq!(e(&eval("=CUMIPMT(0,360,125000,1,1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CUMIPMT(-0.01,360,125000,1,1,0)")), CalcError::Num);
    }

    #[test]
    fn pv_nper_nonpositive_num() {
        assert_eq!(e(&eval("=CUMIPMT(0.01,0,125000,1,1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CUMIPMT(0.01,360,0,1,1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CUMIPMT(0.01,360,-5,1,1,0)")), CalcError::Num);
    }

    #[test]
    fn period_range_num() {
        assert_eq!(e(&eval("=CUMIPMT(0.01,360,125000,0,12,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CUMIPMT(0.01,360,125000,1,0,0)")), CalcError::Num);
        // end beyond nper is #NUM! (reference behavior; spec-confirm).
        assert_eq!(e(&eval("=CUMIPMT(0.01,36,125000,1,37,0)")), CalcError::Num);
    }

    #[test]
    fn bad_type_num() {
        assert_eq!(e(&eval("=CUMIPMT(0.01,36,125000,1,2,2)")), CalcError::Num);
        assert_eq!(e(&eval("=CUMIPMT(0.01,36,125000,1,2,-1)")), CalcError::Num);
    }

    #[test]
    fn periods_truncate() {
        assert_eq!(n(&eval("=CUMIPMT(0.09/12,360,125000,1.9,1.9,0)")), -937.5);
    }

    #[test]
    fn type1_first_period() {
        // Due payment: interest accrues on the post-payment balance.
        let v = n(&eval("=CUMIPMT(0.09/12,360,125000,1,1,1)"));
        assert!(v < 0.0 && v > -937.5);
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(r#"=CUMIPMT("x",360,125000,1,1,0)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=CUMIPMT(1/0,360,125000,1,1,0)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CUMIPMT(1,2,3,4,5)")), CalcError::Value);
        assert_eq!(e(&eval("=CUMIPMT(1,2,3,4,5,6,7)")), CalcError::Value);
    }
}
