//! `RECEIVED(settlement, maturity, investment, discount, [basis])` —
//! amount received at maturity for a fully invested discount
//! security: `investment / (1 - discount * yearfrac(s, m, basis))`.
//! Spec: `docs/functions/RECEIVED.md`.
//!
//! A nonpositive discounting denominator `1 - discount*frac` is
//! `#NUM!` (SPEC-OPEN: `#NUM!` vs `#DIV/0!` unconfirmed).

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
    let investment = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let discount = match arg_num(ctx, args, 3)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let basis = match arg_basis(ctx, args, 4)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if settlement >= maturity || investment <= 0.0 || discount <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let yf = match finance::year_fraction(settlement, maturity, basis, ctx.date_system()) {
        Some(yf) => yf,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    let denom = 1.0 - discount * yf;
    if denom <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(investment / denom))
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
        // 30/360 DSM = 176: 100000 / (1 - 0.05*176/360).
        let got = n(&eval("=RECEIVED(45000,45180,100000,0.05,0)"));
        assert!((got - 102505.6948).abs() < 1e-3, "got {got}");
    }

    #[test]
    fn basis_act360() {
        // 1e6 / (1 - 0.0575*146/360).
        let got = n(&eval("=RECEIVED(39448,39594,1000000,0.0575,2)"));
        assert!((got - 1023876.23).abs() < 0.05, "got {got}");
    }

    #[test]
    fn basis_act365() {
        // 1e5 / (1 - 0.05*180/365) = 102528.09.
        let got = n(&eval("=RECEIVED(45000,45180,100000,0.05,3)"));
        assert!((got - 102528.0899).abs() < 0.01, "got {got}");
    }

    #[test]
    fn dates_equal_num() {
        assert_eq!(
            e(&eval("=RECEIVED(45000,45000,100000,0.05)")),
            CalcError::Num
        );
    }

    #[test]
    fn investment_zero_num() {
        assert_eq!(e(&eval("=RECEIVED(45000,45180,0,0.05)")), CalcError::Num);
    }

    #[test]
    fn investment_negative_num() {
        assert_eq!(e(&eval("=RECEIVED(45000,45180,-5,0.05)")), CalcError::Num);
    }

    #[test]
    fn discount_zero_num() {
        assert_eq!(e(&eval("=RECEIVED(45000,45180,100,0)")), CalcError::Num);
    }

    #[test]
    fn denominator_nonpositive_num() {
        // discount*frac = 3.0*0.9833 > 1 -> denominator negative.
        assert_eq!(e(&eval("=RECEIVED(45000,45360,100,3.0,0)")), CalcError::Num);
    }

    #[test]
    fn basis_out_of_range_num() {
        assert_eq!(
            e(&eval("=RECEIVED(45000,45180,100,0.05,9)")),
            CalcError::Num
        );
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(
            e(&eval(r#"=RECEIVED(45000,"x",100,0.05)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn text_number_coerces() {
        let got = n(&eval(r#"=RECEIVED(45000,45180,"100000",0.05,0)"#));
        assert!((got - 102505.6948).abs() < 1e-3, "got {got}");
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::Ref))],
            "=RECEIVED(45000,45180,100,A1)",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }
}
