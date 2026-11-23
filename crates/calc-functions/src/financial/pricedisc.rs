//! `PRICEDISC(settlement, maturity, discount, redemption, [basis])` —
//! price per $100 face of a discount security:
//! `redemption * (1 - discount * yearfrac(settlement, maturity, basis))`.
//! Spec: `docs/functions/PRICEDISC.md`.
//!
//! `discount = 0` is allowed (returns `redemption`) per the spec's
//! reading of the documented `< 0` error; `redemption <= 0` is
//! `#NUM!` (SPEC-OPEN boundary, assumed per docs).

use crate::common::finance;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::{arg_basis, arg_date, arg_num};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 5) {
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
    let discount = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let redemption = match arg_num(ctx, args, 3)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let basis = match arg_basis(ctx, args, 4)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if settlement >= maturity || discount < 0.0 || redemption <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    match finance::year_fraction(settlement, maturity, basis, ctx.date_system()) {
        Some(yf) => Ok(Value::Number(redemption * (1.0 - discount * yf))),
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
    fn spec_act365() {
        // 100*(1 - 0.05*180/365) = 97.53425.
        let got = n(&eval("=PRICEDISC(45000,45180,0.05,100,3)"));
        assert!((got - 97.5342466).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn spec_us30360_half_year() {
        // Mar15->Sep11 counts 176 NASD days -> 100*(1-0.05*176/360).
        let got = n(&eval("=PRICEDISC(45000,45180,0.05,100,0)"));
        assert!((got - 97.5555556).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn basis_act360() {
        // 100*(1 - 0.05*180/360) = 97.5.
        assert_eq!(n(&eval("=PRICEDISC(45000,45180,0.05,100,2)")), 97.5);
    }

    #[test]
    fn basis_actact_same_year() {
        // 2023 not leap: 100*(1 - 0.05*180/365).
        let got = n(&eval("=PRICEDISC(45000,45180,0.05,100,1)"));
        assert!((got - 97.5342466).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn basis_eur30360() {
        // EU 30/360: Mar15->Sep12 counts 177 -> 100*(1-0.05*177/360).
        let got = n(&eval("=PRICEDISC(45000,45181,0.05,100,4)"));
        assert!((got - 97.5416667).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn discount_zero_returns_redemption() {
        // SPEC-OPEN: docs bound is discount < 0.
        assert_eq!(n(&eval("=PRICEDISC(45000,45180,0,100)")), 100.0);
    }

    #[test]
    fn discount_negative_num() {
        assert_eq!(
            e(&eval("=PRICEDISC(45000,45180,-0.05,100)")),
            CalcError::Num
        );
    }

    #[test]
    fn redemption_zero_num() {
        assert_eq!(e(&eval("=PRICEDISC(45000,45180,0.05,0)")), CalcError::Num);
    }

    #[test]
    fn dates_equal_num() {
        assert_eq!(e(&eval("=PRICEDISC(45000,45000,0.05,100)")), CalcError::Num);
    }

    #[test]
    fn dates_inverted_num() {
        assert_eq!(e(&eval("=PRICEDISC(45180,45000,0.05,100)")), CalcError::Num);
    }

    #[test]
    fn basis_out_of_range_num() {
        assert_eq!(
            e(&eval("=PRICEDISC(45000,45180,0.05,100,5)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=PRICEDISC(45000,45180,0.05,100,-1)")),
            CalcError::Num
        );
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(
            e(&eval(r#"=PRICEDISC(45000,45180,"x",100)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn date_fraction_truncates() {
        assert_eq!(
            n(&eval("=PRICEDISC(45000.9,45180,0.05,100,0)")),
            n(&eval("=PRICEDISC(45000,45180,0.05,100,0)"))
        );
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=PRICEDISC(45000,45180,A1,100)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
