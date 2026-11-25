//! `INTRATE(settlement, maturity, investment, redemption, [basis])` —
//! simple interest rate of a fully invested security.
//! Spec: `docs/functions/INTRATE.md`.
//!
//! `(redemption - investment)/investment / YEARFRAC(settlement,
//! maturity, basis)` — the day-count conventions come from
//! [`finance::year_fraction`]. Dates truncate to whole serials.

use crate::common::{coercion, date_serial, finance};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 5) {
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
    let investment = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let redemption = match coercion::eval_number(ctx, &args[3])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let basis_code = match coercion::eval_opt_number(ctx, args.get(4), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => date_serial::trunc_to_i64(n),
    };
    let Some(basis) = finance::DayCountBasis::from_code(basis_code) else {
        return Ok(Value::Error(CalcError::Num));
    };
    if settlement >= maturity || investment <= 0.0 || redemption <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let Some(yf) = finance::year_fraction(settlement, maturity, basis, ctx.date_system()) else {
        return Ok(Value::Error(CalcError::Num));
    };
    if yf == 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number((redemption - investment) / investment / yf))
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
    fn doc_example_basis2() {
        let v = eval("=INTRATE(DATE(2008,2,15),DATE(2008,5,15),1000000,1014420,2)");
        assert!((n(&v) - 0.05768).abs() < 1e-5, "{v:?}");
    }

    #[test]
    fn doc_example_basis3() {
        let v = eval("=INTRATE(DATE(2008,2,15),DATE(2008,5,15),1000000,1014420,3)");
        assert!((n(&v) - 0.058481111).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn doc_example_basis0() {
        let v = eval("=INTRATE(DATE(2008,2,15),DATE(2008,5,15),1000000,1014420,0)");
        assert!((n(&v) - 0.05768).abs() < 1e-5, "{v:?}");
    }

    #[test]
    fn reversed_dates_num() {
        let v = eval("=INTRATE(DATE(2008,5,15),DATE(2008,2,15),1000000,1014420,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn zero_investment_num() {
        let v = eval("=INTRATE(DATE(2008,2,15),DATE(2008,5,15),0,1014420)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_basis_num() {
        let v = eval("=INTRATE(DATE(2008,2,15),DATE(2008,5,15),1000000,1014420,5)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn redemption_below_investment_negative_rate() {
        // A loss is a negative rate, not an error (INTRATE.md).
        let v = eval("=INTRATE(DATE(2008,2,15),DATE(2009,2,15),1000000,900000,0)");
        assert!(n(&v) < 0.0, "{v:?}");
    }

    #[test]
    fn zero_redemption_num() {
        // redemption <= 0 -> #NUM! (INTRATE.md open question).
        let v = eval("=INTRATE(DATE(2008,2,15),DATE(2008,5,15),1000000,0,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn same_day_num() {
        let v = eval("=INTRATE(DATE(2008,2,15),DATE(2008,2,15),1,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_text_value_error() {
        let v = eval(r#"=INTRATE("x",DATE(2008,5,15),1000000,1014420)"#);
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=INTRATE(A1,DATE(2008,5,15),1000000,1014420)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=INTRATE(1,2,3)")), CalcError::Value);
    }
}
