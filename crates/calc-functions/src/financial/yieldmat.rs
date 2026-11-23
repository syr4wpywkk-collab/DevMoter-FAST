//! `YIELDMAT(settlement, maturity, issue, rate, pr, [basis])` —
//! annual yield of a security paying interest at maturity.
//! Spec: `docs/functions/YIELDMAT.md`.
//!
//! Documented Microsoft closed form, each `days/B` pair a
//! [`finance::year_fraction`]:
//! `( (1 + yf_IM*rate - (pr/100 + yf_IS*rate)) / (pr/100 + yf_IS*rate) )
//!  / yf_SM`.
//!
//! `issue <= settlement` required (SPEC-OPEN: `settlement < issue`
//! error class assumed `#NUM!` like the other date-order bounds).

use crate::common::finance;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::{arg_basis, arg_date, arg_num};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 5, 6) {
        return Ok(Value::Error(e));
    }
    let settlement = match arg_date(ctx, args, 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let maturity = match arg_date(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let issue = match arg_date(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let rate = match arg_num(ctx, args, 3)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let pr = match arg_num(ctx, args, 4)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let basis = match arg_basis(ctx, args, 5)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if settlement >= maturity || settlement < issue || rate < 0.0 || pr <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let ds = ctx.date_system();
    let yf = |a: i64, b: i64| finance::year_fraction(a, b, basis, ds);
    match (
        yf(issue, maturity),
        yf(settlement, maturity),
        yf(issue, settlement),
    ) {
        (Some(dim), Some(dsm), Some(a)) => {
            let basis_price = pr / 100.0 + a * rate;
            Ok(Value::Number(
                ((1.0 + dim * rate - basis_price) / basis_price) / dsm,
            ))
        }
        _ => Ok(Value::Error(CalcError::Num)),
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
    fn spec_excel_doc_example() {
        // Documented example: settlement 2008-03-15, maturity
        // 2008-11-03, issue 2007-11-08, rate 6.25%, pr 100.0123,
        // basis 0 -> 0.060954.
        let got = n(&eval("=YIELDMAT(39522,39755,39394,0.0625,100.0123,0)"));
        assert!((got - 0.0609543).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn par_zero_accrued() {
        // issue == settlement, 1yr act/365, pr = 100:
        // ((1 + 0.08 - 1)/1) / 1 = 0.08.
        let got = n(&eval("=YIELDMAT(45000,45365,45000,0.08,100,3)"));
        assert!((got - 0.08).abs() < 1e-9, "got {got}");
    }

    #[test]
    fn act365_with_accrued() {
        // dim=1, dsm=183/365, a=182/365, rate=0.08, pr=99.846:
        // base = 0.99846 + 0.49863*0.08 = 1.03835;
        // ((1.08 - 1.03835)/1.03835) / 0.50137 = 0.08.
        let got = n(&eval("=YIELDMAT(45182,45365,45000,0.08,99.846,3)"));
        assert!((got - 0.08).abs() < 1e-3, "got {got}");
    }

    #[test]
    fn dates_equal_num() {
        assert_eq!(
            e(&eval("=YIELDMAT(45000,45000,44000,0.05,100)")),
            CalcError::Num
        );
    }

    #[test]
    fn settlement_before_issue_num() {
        // SPEC-OPEN: error class for issue > settlement.
        assert_eq!(
            e(&eval("=YIELDMAT(44000,45000,44100,0.05,100)")),
            CalcError::Num
        );
    }

    #[test]
    fn rate_negative_num() {
        assert_eq!(
            e(&eval("=YIELDMAT(45000,45180,44000,-0.05,100)")),
            CalcError::Num
        );
    }

    #[test]
    fn pr_zero_num() {
        assert_eq!(
            e(&eval("=YIELDMAT(45000,45180,44000,0.05,0)")),
            CalcError::Num
        );
    }

    #[test]
    fn basis_out_of_range_num() {
        assert_eq!(
            e(&eval("=YIELDMAT(45000,45180,44000,0.05,100,6)")),
            CalcError::Num
        );
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(
            e(&eval(r#"=YIELDMAT(45000,45180,44000,0.05,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn date_fraction_truncates() {
        assert_eq!(
            n(&eval("=YIELDMAT(45000.7,45365,45000,0.08,100,3)")),
            n(&eval("=YIELDMAT(45000,45365,45000,0.08,100,3)"))
        );
    }

    #[test]
    fn default_basis_zero() {
        assert_eq!(
            n(&eval("=YIELDMAT(45000,45360,44640,0.05,100)")),
            n(&eval("=YIELDMAT(45000,45360,44640,0.05,100,0)"))
        );
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::Ref))],
            "=YIELDMAT(45000,45180,44000,A1,100)",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }
}
