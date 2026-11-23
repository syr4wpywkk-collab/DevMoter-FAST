//! `ODDLPRICE(settlement, maturity, last_interest, rate, yld,
//! redemption, frequency, [basis])` — price per 100 face of a security
//! with an odd last coupon period. Spec: `docs/functions/ODDLPRICE.md`.
//!
//! Kernel: [`finance::oddl_price`] — the documented closed form over
//! the last coupon period's year fractions. Ordering `maturity >
//! settlement > last_interest` must hold.

use crate::common::{coercion, date_serial, finance};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// `(settlement, maturity, last_interest, rate, yld_or_pr, redemption,
/// frequency, basis)` — `yld_or_pr` is `yld` for ODDLPRICE and `pr`
/// for ODDLYIELD.
type OddlArgs = (i64, i64, i64, f64, f64, f64, i64, finance::DayCountBasis);

pub(crate) fn eval_args(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Result<Result<OddlArgs, CalcError>, EvalError> {
    if let Err(e) = check_arity(args, 7, 8) {
        return Ok(Err(e));
    }
    let mut dates = [0i64; 3];
    for (i, d) in dates.iter_mut().enumerate() {
        *d = match super::date_arg(ctx, &args[i])? {
            Err(e) => return Ok(Err(e)),
            Ok(n) => n,
        };
    }
    let mut nums = [0f64; 4];
    for (i, n) in nums.iter_mut().enumerate() {
        *n = match coercion::eval_number(ctx, &args[i + 3])? {
            Err(e) => return Ok(Err(e)),
            Ok(v) => v,
        };
    }
    let basis_code = match coercion::eval_opt_number(ctx, args.get(7), 0.0)? {
        Err(e) => return Ok(Err(e)),
        Ok(n) => date_serial::trunc_to_i64(n),
    };
    let Some(basis) = finance::DayCountBasis::from_code(basis_code) else {
        return Ok(Err(CalcError::Num));
    };
    let [settlement, maturity, last_interest] = dates;
    let [rate, second, redemption, freq] = nums;
    let frequency = date_serial::trunc_to_i64(freq);
    if !(maturity > settlement && settlement > last_interest)
        || rate < 0.0
        || second < 0.0
        || redemption <= 0.0
        || finance::months_per_period(frequency).is_none()
    {
        return Ok(Err(CalcError::Num));
    }
    Ok(Ok((
        settlement,
        maturity,
        last_interest,
        rate,
        second,
        redemption,
        frequency,
        basis,
    )))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let (settlement, maturity, last_interest, rate, yld, redemption, frequency, basis) =
        match eval_args(ctx, args)? {
            Ok(t) => t,
            Err(e) => return Ok(Value::Error(e)),
        };
    match finance::oddl_price(
        settlement,
        maturity,
        last_interest,
        rate,
        yld,
        redemption,
        frequency,
        basis,
        ctx.date_system(),
    ) {
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
        // MS doc example: settlement 2008-02-07, maturity 2008-06-15,
        // last coupon 2007-10-15 -> 99.87829.
        let v = eval(
            "=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2,0)",
        );
        assert!((n(&v) - 99.87829).abs() < 1e-4, "{v:?}");
    }

    #[test]
    fn regular_tail_matches_price() {
        // When last_interest is exactly one period before maturity,
        // ODDLPRICE agrees with PRICE for the regular tail.
        let a = eval(
            "=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,12,15),0.0375,0.0405,100,2,0)",
        );
        let b = eval("=PRICE(DATE(2008,2,7),DATE(2008,6,15),0.0375,0.0405,100,2,0)");
        assert!((n(&a) - n(&b)).abs() < 1e-9, "{a:?} vs {b:?}");
    }

    #[test]
    fn ordering_num() {
        // settlement <= last_interest.
        let v = eval(
            "=ODDLPRICE(DATE(2007,10,15),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn maturity_before_settlement_num() {
        let v =
            eval("=ODDLPRICE(DATE(2008,6,15),DATE(2008,2,7),DATE(2007,10,15),0.0375,0.0405,100,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_rate_num() {
        let v =
            eval("=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),-0.05,0.0405,100,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_yield_num() {
        let v =
            eval("=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,-0.05,100,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_frequency_num() {
        let v =
            eval("=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,3)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_basis_num() {
        let v = eval(
            "=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2,9)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn zero_yield() {
        // yld = 0: price = redemption + final coupon - accrued.
        let v =
            eval("=ODDLPRICE(DATE(2008,2,7),DATE(2008,6,15),DATE(2007,10,15),0.0375,0,100,2,0)");
        // DCi = 240/180 per 30/360; Ai = 112/180.
        let expected = 100.0 + (240.0 / 360.0 * 2.0) * 100.0 * 0.0375 / 2.0
            - (112.0 / 360.0 * 2.0) * 100.0 * 0.0375 / 2.0;
        assert!((n(&v) - expected).abs() < 1e-9, "{v:?} vs {expected}");
    }

    #[test]
    fn bad_text_value_error() {
        let v = eval(r#"=ODDLPRICE("x",DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2)"#);
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=ODDLPRICE(A1,DATE(2008,6,15),DATE(2007,10,15),0.0375,0.0405,100,2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ODDLPRICE(1,2,3,4,5,6)")), CalcError::Value);
    }
}
