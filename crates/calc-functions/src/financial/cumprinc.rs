//! `CUMPRINC(rate, nper, pv, start_period, end_period, type)` —
//! cumulative principal paid over the inclusive 1-based period range.
//! Spec: `docs/functions/CUMPRINC.md`.
//!
//! `Σ PPMT` where `PPMT = PMT - IPMT`, so the cumulative principal is
//! `count * pmt - CUMIPMT(start..end)` — the invariant the spec
//! requires.

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
    let interest: f64 = (a.start..=a.end)
        .map(|per| ipmt(a.rate, per, a.pv, pmt, a.typ))
        .sum();
    let count = (a.end - a.start + 1) as f64;
    Ok(Value::Number(count * pmt - interest))
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
        assert!((n(&eval("=CUMPRINC(0.09/12,360,125000,13,24,0)")) - -934.1071234).abs() < 1e-5);
        assert!((n(&eval("=CUMPRINC(0.09/12,360,125000,2,2,0)")) - -68.79035821).abs() < 1e-6);
        assert!((n(&eval("=CUMPRINC(0.09/12,360,125000,1,360,0)")) - -125000.0).abs() < 1e-4);
        assert_eq!(
            e(&eval("=CUMPRINC(0.09/12,360,125000,0,12,0)")),
            CalcError::Num
        );
    }

    #[test]
    fn invariant_with_cumipmt() {
        let p = n(&eval("=CUMPRINC(0.09/12,360,125000,13,24,0)"));
        let i = n(&eval("=CUMIPMT(0.09/12,360,125000,13,24,0)"));
        // 12 * PMT = principal + interest.
        assert!((p + i - -12069.34).abs() < 0.01);
    }

    #[test]
    fn type1() {
        let p = n(&eval("=CUMPRINC(0.09/12,360,125000,13,24,1)"));
        let i = n(&eval("=CUMIPMT(0.09/12,360,125000,13,24,1)"));
        // PMT_due = PMT_ord/(1+r); count*pmt_due = p+i.
        assert!((p + i - -11979.49).abs() < 0.01);
    }

    #[test]
    fn full_range_recovers_pv() {
        assert!((n(&eval("=CUMPRINC(0.05,20,50000,1,20,0)")) - -50000.0).abs() < 1e-4);
    }

    #[test]
    fn rate_pv_nper_num() {
        assert_eq!(e(&eval("=CUMPRINC(0,36,125000,1,1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CUMPRINC(0.01,0,125000,1,1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CUMPRINC(0.01,36,0,1,1,0)")), CalcError::Num);
    }

    #[test]
    fn range_and_type_num() {
        assert_eq!(e(&eval("=CUMPRINC(0.01,36,125000,5,2,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CUMPRINC(0.01,36,125000,1,37,0)")), CalcError::Num);
        assert_eq!(e(&eval("=CUMPRINC(0.01,36,125000,1,2,3)")), CalcError::Num);
    }

    #[test]
    fn periods_truncate() {
        assert_eq!(
            n(&eval("=CUMPRINC(0.09/12,360,125000,2.9,2.9,0)")),
            n(&eval("=CUMPRINC(0.09/12,360,125000,2,2,0)"))
        );
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(r#"=CUMPRINC("x",360,125000,1,1,0)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=CUMPRINC(1/0,360,125000,1,1,0)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=CUMPRINC(1,2,3,4,5)")), CalcError::Value);
        assert_eq!(e(&eval("=CUMPRINC(1,2,3,4,5,6,7)")), CalcError::Value);
    }
}
