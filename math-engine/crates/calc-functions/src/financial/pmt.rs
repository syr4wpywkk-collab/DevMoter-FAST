//! `PMT(rate, nper, pv, [fv], [type])` — constant periodic payment for
//! a loan/annuity. Spec: `docs/functions/PMT.md`.
//!
//! Closed form via [`finance::annuity_pmt`]; `rate = 0` degenerates to
//! `-(pv + fv)/nper`. `nper = 0` divides by zero — reported as
//! `#DIV/0!` (PMT.md open question).

use crate::common::{coercion, finance};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 5) {
        return Ok(Value::Error(e));
    }
    let rate = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let nper = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let pv = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let fv = match coercion::eval_opt_number(ctx, args.get(3), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let typ = match coercion::eval_opt_number(ctx, args.get(4), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => f64::from(n != 0.0),
    };
    let pmt = finance::annuity_pmt(rate, nper, pv, fv, typ);
    if !pmt.is_finite() {
        return Ok(Value::Error(if nper == 0.0 {
            // Division by nper (PMT.md open question: #DIV/0! vs #NUM!).
            CalcError::DivZero
        } else {
            CalcError::Num
        }));
    }
    Ok(Value::Number(pmt))
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
    fn doc_example_loan() {
        let v = eval("=PMT(0.005,36,10000)");
        assert!((n(&v) - -304.2194).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn zero_rate() {
        assert_eq!(n(&eval("=PMT(0,12,1200)")), -100.0);
    }

    #[test]
    fn begin_of_period() {
        let v = eval("=PMT(0.005,36,10000,0,1)");
        // Begin-of-period payment = end-of-period / (1 + rate).
        assert!((n(&v) - -302.7058).abs() < 1e-3, "{v:?}");
        assert!((n(&v) * 1.005 - -304.2194).abs() < 1e-3);
    }

    #[test]
    fn savings_target_fv() {
        // fv < 0 (a received lump) -> positive payment; the spec doc's
        // negative sign is a typo (flagged in the PR).
        let v = eval("=PMT(0.05,10,0,-10000)");
        assert!((n(&v) - 795.0459).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn fv_and_pv_together() {
        // Payment amortizes pv while hitting the fv target: FV at the
        // solved payment reaches exactly fv.
        let pmt = n(&eval("=PMT(0.1,10,10000,-10000)"));
        let fv = eval(&format!("=FV(0.1,10,{pmt},10000)"));
        assert!((n(&fv) - -10000.0).abs() < 1e-6, "{fv:?}");
    }

    #[test]
    fn tiny_rate_stable() {
        // 1e-12 rate: near the -(pv+fv)/nper limit, no cancellation.
        let v = eval("=PMT(1e-12,10,10000)");
        assert!((n(&v) - -1000.0).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn negative_pv_positive_pmt() {
        assert!(n(&eval("=PMT(0.005,36,-10000)")) > 0.0);
    }

    #[test]
    fn nper_zero_div0() {
        assert_eq!(e(&eval("=PMT(0.1,0,10000)")), CalcError::DivZero);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=PMT("x",36,10000)"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=PMT(0,"12",1200)"#)), -100.0);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Ref))], "=PMT(A1,36,10000)");
        assert_eq!(e(&v), CalcError::Ref);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=PMT(1,2)")), CalcError::Value);
    }
}
