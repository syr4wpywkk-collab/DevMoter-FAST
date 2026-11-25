//! `PRICEMAT(settlement, maturity, issue, rate, yld, [basis])` —
//! price per $100 face of a security paying interest at maturity.
//! Spec: `docs/functions/PRICEMAT.md`.
//!
//! Documented Microsoft form, with each `days/B` pair as a
//! [`finance::year_fraction`]:
//! `(100 + yf_IM*100*rate) / (1 + yf_SM*yld) - yf_IS*100*rate`.
//!
//! `issue <= settlement` is required (SPEC-OPEN: docs only say
//! "invalid dates -> #NUM!"; `settlement < issue` treated as
//! invalid).

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
    let yld = match arg_num(ctx, args, 4)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let basis = match arg_basis(ctx, args, 5)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if settlement >= maturity || settlement < issue || rate < 0.0 || yld < 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let ds = ctx.date_system();
    let yf = |a: i64, b: i64| finance::year_fraction(a, b, basis, ds);
    match (
        yf(issue, maturity),
        yf(settlement, maturity),
        yf(issue, settlement),
    ) {
        (Some(dim), Some(dsm), Some(a)) => Ok(Value::Number(
            (100.0 + dim * 100.0 * rate) / (1.0 + dsm * yld) - a * 100.0 * rate,
        )),
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
        // 30/360 day counts over the serial span (issue Jan, settle
        // Mar, maturity Jun 2008): (100 + 130/360*2.5)/(1 + 78/360*
        // 0.0305) - 52/360*2.5 = 99.8799.
        let got = n(&eval("=PRICEMAT(39535,39614,39484,0.025,0.0305,0)"));
        assert!((got - 99.8808).abs() < 1e-2, "got {got}");
    }

    #[test]
    fn act365_full_year() {
        // issue=45000, maturity=45365, settlement=45182 (mid):
        // (100+8)/(1+0.08*183/365) - (182/365)*8 = 99.8463.
        let got = n(&eval("=PRICEMAT(45182,45365,45000,0.08,0.08,3)"));
        assert!((got - 99.8463).abs() < 1e-3, "got {got}");
    }

    #[test]
    fn settlement_on_issue_date() {
        // A = 0: price discounts the full maturity payment.
        // dim = 1yr (act/365), dsm = 1yr: (100 + 8)/(1.08) = 100.
        let got = n(&eval("=PRICEMAT(45000,45365,45000,0.08,0.08,3)"));
        assert!((got - 100.0).abs() < 1e-9, "got {got}");
    }

    #[test]
    fn zero_rate_and_yield() {
        // rate = yld = 0 -> 100/1 - 0 = 100.
        assert_eq!(n(&eval("=PRICEMAT(45000,45180,44000,0,0,0)")), 100.0);
    }

    #[test]
    fn dates_equal_num() {
        assert_eq!(
            e(&eval("=PRICEMAT(45000,45000,44000,0.05,0.05)")),
            CalcError::Num
        );
    }

    #[test]
    fn settlement_before_issue_num() {
        // SPEC-OPEN: error class for issue > settlement.
        assert_eq!(
            e(&eval("=PRICEMAT(44000,45000,44100,0.05,0.05)")),
            CalcError::Num
        );
    }

    #[test]
    fn rate_negative_num() {
        assert_eq!(
            e(&eval("=PRICEMAT(45000,45180,44000,-0.01,0.05)")),
            CalcError::Num
        );
    }

    #[test]
    fn yld_negative_num() {
        assert_eq!(
            e(&eval("=PRICEMAT(45000,45180,44000,0.05,-0.01)")),
            CalcError::Num
        );
    }

    #[test]
    fn basis_out_of_range_num() {
        assert_eq!(
            e(&eval("=PRICEMAT(45000,45180,44000,0.05,0.05,5)")),
            CalcError::Num
        );
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(
            e(&eval(r#"=PRICEMAT(45000,45180,44000,"x",0.05)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn default_basis_zero() {
        assert_eq!(
            n(&eval("=PRICEMAT(45000,45360,44640,0.05,0.05)")),
            n(&eval("=PRICEMAT(45000,45360,44640,0.05,0.05,0)"))
        );
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=PRICEMAT(45000,45180,44000,0.05,A1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
