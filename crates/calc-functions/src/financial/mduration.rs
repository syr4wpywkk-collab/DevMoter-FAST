//! `MDURATION(settlement, maturity, coupon, yld, frequency, [basis])`
//! — modified Macaulay duration in years, per 100 face.
//! Spec: `docs/functions/MDURATION.md`.
//!
//! `MDURATION = DURATION / (1 + yld/frequency)` over the
//! [`finance::macaulay_duration`] kernel.

use crate::common::{coercion, date_serial, finance};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 5, 6) {
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
    let coupon = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let yld = match coercion::eval_number(ctx, &args[3])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let frequency = match coercion::eval_number(ctx, &args[4])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => date_serial::trunc_to_i64(n),
    };
    let basis_code = match coercion::eval_opt_number(ctx, args.get(5), 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => date_serial::trunc_to_i64(n),
    };
    let Some(basis) = finance::DayCountBasis::from_code(basis_code) else {
        return Ok(Value::Error(CalcError::Num));
    };
    if settlement >= maturity
        || coupon < 0.0
        || yld < 0.0
        || finance::months_per_period(frequency).is_none()
    {
        return Ok(Value::Error(CalcError::Num));
    }
    match finance::macaulay_duration(
        settlement,
        maturity,
        coupon,
        yld,
        frequency,
        basis,
        ctx.date_system(),
    ) {
        Some(d) if d.is_finite() => Ok(Value::Number(d / (1.0 + yld / frequency as f64))),
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
    fn doc_example_semiannual() {
        let v = eval("=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,0)");
        assert!((n(&v) - 5.7356698).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn doc_example_annual() {
        let v = eval("=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,1,0)");
        assert!((n(&v) - 5.6413466).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn doc_example_par_bond() {
        let v = eval("=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.08,2,0)");
        // Par bond at yld = coupon: closed form (1-(1+r)^-N)/r / f
        // with r = 0.04, N = 16 -> 5.8261478 (the spec doc's 5.8309564
        // fails this identity — flagged in the PR).
        assert!((n(&v) - 5.8261478).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn reversed_dates_num() {
        let v = eval("=MDURATION(DATE(2016,1,1),DATE(2008,1,1),0.08,0.09,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_coupon_num() {
        let v = eval("=MDURATION(DATE(2008,1,1),DATE(2016,1,1),-0.08,0.09,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_yield_num() {
        let v = eval("=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,-0.09,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_frequency_num() {
        let v = eval("=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,3)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_basis_num() {
        let v = eval("=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,9)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn higher_yield_shorter_duration() {
        let a = eval("=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2)");
        let b = eval("=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.05,2)");
        assert!(n(&a) < n(&b));
    }

    #[test]
    fn zero_coupon_is_time_to_maturity() {
        // Zero-coupon bond: duration = years to maturity (8y) then
        // modified by 1+y/f.
        let v = eval("=MDURATION(DATE(2008,1,1),DATE(2016,1,1),0,0.09,1,0)");
        assert!((n(&v) - 8.0 / 1.09).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn bad_text_value_error() {
        let v = eval(r#"=MDURATION("x",DATE(2016,1,1),0.08,0.09,2)"#);
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=MDURATION(A1,DATE(2016,1,1),0.08,0.09,2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MDURATION(1,2,3,4)")), CalcError::Value);
    }
}
