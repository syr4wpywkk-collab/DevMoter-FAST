//! `PRICE(settlement, maturity, rate, yld, redemption, frequency,
//! [basis])` — price per 100 face of a periodic-interest security.
//! Spec: `docs/functions/PRICE.md`.
//!
//! Kernel: [`finance::bond_price`] — discounting over the remaining
//! coupons at `yld/frequency`, minus accrued interest; a single
//! remaining coupon uses the documented simple-interest form.
//! Dates truncate to whole serials; `frequency`/`basis` truncate.

use crate::common::{coercion, date_serial, finance};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 6, 7) {
        return Ok(Value::Error(e));
    }
    let settlement = match super::date_arg(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let maturity = match super::date_arg(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let rate = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let yld = match coercion::eval_number(ctx, &args[3])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let redemption = match coercion::eval_number(ctx, &args[4])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let frequency = match coercion::eval_number(ctx, &args[5])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => date_serial::trunc_to_i64(n),
    };
    let basis_code = match coercion::eval_opt_number(ctx, args.get(6), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => date_serial::trunc_to_i64(n),
    };
    let Some(basis) = finance::DayCountBasis::from_code(basis_code) else {
        return Ok(Value::Error(CalcError::Num));
    };
    if settlement >= maturity
        || rate < 0.0
        || yld < 0.0
        || redemption <= 0.0
        || finance::months_per_period(frequency).is_none()
    {
        return Ok(Value::Error(CalcError::Num));
    }
    let b = finance::BondArgs {
        settlement,
        maturity,
        rate,
        yld,
        redemption,
        frequency,
        basis,
    };
    match finance::bond_price(&b, ctx.date_system()) {
        Some(v) if v.is_finite() => Ok(Value::Number(v)),
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
    fn doc_example() {
        // MS doc example: 2008-02-15, 2017-11-15, 5.75% coupon, 6.5%
        // yield, semiannual, 30/360 -> 94.63436.
        let v = eval("=PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.065,100,2,0)");
        assert!((n(&v) - 94.63436).abs() < 1e-4, "{v:?}");
    }

    #[test]
    fn par_bond_on_coupon_date() {
        // Settlement exactly on a coupon date, yld == rate -> 100.
        let v = eval("=PRICE(DATE(2008,1,1),DATE(2016,1,1),0.08,0.08,100,2,0)");
        assert!((n(&v) - 100.0).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn zero_coupon() {
        // Zero-coupon, one period: (100)/(1 + y·DSC/E) - 0.
        let v = eval("=PRICE(DATE(2008,1,1),DATE(2009,1,1),0,0.05,100,1,0)");
        assert!((n(&v) - 100.0 / 1.05).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn premium_bond() {
        // yld < coupon -> price above 100.
        let v = eval("=PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.05,100,2,0)");
        assert!(n(&v) > 100.0, "{v:?}");
    }

    #[test]
    fn single_remaining_coupon() {
        // Settlement inside the final coupon period: dirty price
        // (102.875 discounted one month) minus accrued 2.3958.
        let v = eval("=PRICE(DATE(2017,10,15),DATE(2017,11,15),0.0575,0.065,100,2,0)");
        let expected = 102.875 / (1.0 + (30.0 / 180.0) * 0.0325) - (150.0 / 180.0) * 2.875;
        assert!((n(&v) - expected).abs() < 1e-9, "{v:?} vs {expected}");
    }

    #[test]
    fn reversed_dates_num() {
        let v = eval("=PRICE(DATE(2017,11,15),DATE(2008,2,15),0.0575,0.065,100,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_rate_num() {
        let v = eval("=PRICE(DATE(2008,2,15),DATE(2017,11,15),-0.05,0.065,100,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_yield_num() {
        // Docs say yld < 0 -> #NUM! (PRICE.md open question on
        // modern Excel accepting negative yields).
        let v = eval("=PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,-0.01,100,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_frequency_num() {
        let v = eval("=PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.065,100,3)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_basis_num() {
        let v = eval("=PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.065,100,2,5)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn fractional_serials_truncate() {
        let a = eval("=PRICE(39448.9,41778.9,0.0575,0.065,100,2,0)");
        let b = eval("=PRICE(39448,41778,0.0575,0.065,100,2,0)");
        assert_eq!(n(&a), n(&b));
    }

    #[test]
    fn basis3_act365() {
        // Actual/365 basis produces a slightly different price.
        let a = eval("=PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.065,100,2,3)");
        let b = eval("=PRICE(DATE(2008,2,15),DATE(2017,11,15),0.0575,0.065,100,2,0)");
        assert!(n(&a).is_finite());
        assert!((n(&a) - n(&b)).abs() > 1e-6);
    }

    #[test]
    fn bad_text_value_error() {
        let v = eval(r#"=PRICE("x",DATE(2017,11,15),0.0575,0.065,100,2)"#);
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=PRICE(A1,DATE(2017,11,15),0.0575,0.065,100,2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=PRICE(1,2,3,4,5)")), CalcError::Value);
    }
}
