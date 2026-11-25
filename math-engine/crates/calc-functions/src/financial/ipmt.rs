//! `IPMT(rate, per, nper, pv, [fv], [type])` — interest portion of the
//! payment in period `per` of a constant-payment loan.
//! Spec: `docs/functions/IPMT.md`.
//!
//! `IPMT = rate · balance`, where the balance going into period `per`
//! is `FV(rate, per-1, pmt, pv, fv)` — the numpy-financial convention
//! Excel follows. For `type = 1` (payments in advance) the balance is
//! divided by `1 + rate`, and period 1 accrues no interest.
//! `per`/`nper` truncate to integers (IPMT.md open question).

use crate::common::{coercion, finance};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Interest portion for `per` (1-based); shared with `PPMT`.
pub(crate) fn interest(rate: f64, per: f64, nper: f64, pv: f64, fv: f64, typ: f64) -> f64 {
    let pmt = finance::annuity_pmt(rate, nper, pv, fv, typ);
    let interest = finance::annuity_fv(rate, per - 1.0, pmt, pv, typ) * rate;
    if typ != 0.0 {
        if per == 1.0 {
            0.0
        } else {
            interest / (1.0 + rate)
        }
    } else {
        interest
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 6) {
        return Ok(Value::Error(e));
    }
    let rate = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let per = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let nper = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let pv = match coercion::eval_number(ctx, &args[3])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let fv = match coercion::eval_opt_number(ctx, args.get(4), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let typ = match coercion::eval_opt_number(ctx, args.get(5), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => f64::from(n != 0.0),
    };
    let (per, nper) = (per.trunc(), nper.trunc());
    if per < 1.0 || per > nper {
        return Ok(Value::Error(CalcError::Num));
    }
    let v = interest(rate, per, nper, pv, fv, typ);
    if !v.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(v))
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
    fn doc_example_first_period() {
        let v = eval("=IPMT(0.1/12,1,36,8000)");
        assert!((n(&v) - -66.66666667).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn doc_example_third_period() {
        let v = eval("=IPMT(0.1/12,3,36,8000)");
        assert!((n(&v) - -63.46218957).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn doc_example_annual() {
        let v = eval("=IPMT(0.1,3,10,200000)");
        assert!((n(&v) - -17364.69341).abs() < 1e-4, "{v:?}");
    }

    #[test]
    fn begin_period_first_is_zero() {
        assert_eq!(n(&eval("=IPMT(0.1/12,1,36,8000,,1)")), 0.0);
    }

    #[test]
    fn begin_period_second() {
        // Interest accrues on (pv + pmt) — the balance after the
        // first advance payment.
        let pmt = n(&eval("=PMT(0.1/12,36,8000,0,1)"));
        let v = eval("=IPMT(0.1/12,2,36,8000,,1)");
        let expected = -(8000.0 + pmt) * 0.1 / 12.0;
        assert!((n(&v) - expected).abs() < 1e-9, "{v:?} vs {expected}");
    }

    #[test]
    fn per_beyond_nper_num() {
        assert_eq!(e(&eval("=IPMT(0.1/12,37,36,8000)")), CalcError::Num);
    }

    #[test]
    fn per_zero_num() {
        assert_eq!(e(&eval("=IPMT(0.1/12,0,36,8000)")), CalcError::Num);
    }

    #[test]
    fn ipmt_plus_ppmt_is_pmt() {
        let i = n(&eval("=IPMT(0.1/12,20,36,8000)"));
        let p = n(&eval("=PPMT(0.1/12,20,36,8000)"));
        let t = n(&eval("=PMT(0.1/12,36,8000)"));
        assert!((i + p - t).abs() < 1e-6);
    }

    #[test]
    fn zero_rate_interest_is_zero() {
        // rate = 0: no interest accrues (IPMT.md open question).
        assert_eq!(n(&eval("=IPMT(0,3,36,8000)")), 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=IPMT("x",1,36,8000)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=IPMT(0.1,A1,36,8000)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IPMT(0.1,1,36)")), CalcError::Value);
    }
}
