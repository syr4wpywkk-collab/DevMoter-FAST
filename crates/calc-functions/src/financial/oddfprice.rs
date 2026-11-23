//! `ODDFPRICE(settlement, maturity, issue, first_coupon, rate, yld,
//! redemption, frequency, [basis])` — price per 100 face of a security
//! with an odd first coupon period. Spec: `docs/functions/ODDFPRICE.md`.
//!
//! Kernel: [`finance::oddf_price`] — the documented Microsoft formula
//! (short first coupon discounted over `DFC`; long first coupon split
//! into quasi-coupon periods). Ordering `maturity > first_coupon >
//! settlement > issue` must hold.

use crate::common::{coercion, date_serial, finance};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// `(settlement, maturity, issue, first_coupon, rate, second_rate,
/// redemption, frequency, basis)` — `second_rate` is `yld` for
/// ODDFPRICE and `pr` for ODDFYIELD.
type OddfArgs = (
    i64,
    i64,
    i64,
    i64,
    f64,
    f64,
    f64,
    i64,
    finance::DayCountBasis,
);

/// Shared argument evaluation for `ODDFPRICE`/`ODDFYIELD`.
pub(crate) fn eval_args(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Result<Result<OddfArgs, CalcError>, EvalError> {
    if let Err(e) = check_arity(args, 8, 9) {
        return Ok(Err(e));
    }
    let mut dates = [0i64; 4];
    for (i, d) in dates.iter_mut().enumerate() {
        *d = match super::date_arg(ctx, &args[i])? {
            Err(e) => return Ok(Err(e)),
            Ok(n) => n,
        };
    }
    let mut nums = [0f64; 4];
    for (i, n) in nums.iter_mut().enumerate() {
        *n = match coercion::eval_number(ctx, &args[i + 4])? {
            Err(e) => return Ok(Err(e)),
            Ok(v) => v,
        };
    }
    let basis_code = match coercion::eval_opt_number(ctx, args.get(8), 0.0)? {
        Err(e) => return Ok(Err(e)),
        Ok(n) => date_serial::trunc_to_i64(n),
    };
    let Some(basis) = finance::DayCountBasis::from_code(basis_code) else {
        return Ok(Err(CalcError::Num));
    };
    let [settlement, maturity, issue, first_coupon] = dates;
    let [rate, second, redemption, freq] = nums;
    let frequency = date_serial::trunc_to_i64(freq);
    if !(maturity > first_coupon && first_coupon > settlement && settlement > issue)
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
        issue,
        first_coupon,
        rate,
        second,
        redemption,
        frequency,
        basis,
    )))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let (settlement, maturity, issue, first_coupon, rate, yld, redemption, frequency, basis) =
        match eval_args(ctx, args)? {
            Ok(t) => t,
            Err(e) => return Ok(Value::Error(e)),
        };
    // yld == 0 is allowed for ODDFPRICE (only rate<0/yld<0 -> #NUM!).
    match finance::oddf_price(
        settlement,
        maturity,
        issue,
        first_coupon,
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

    const EXAMPLE: &str =
        "DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2,1";

    #[test]
    fn doc_example_short_first() {
        // MS doc example (actual/actual basis): 113.5977.
        let v = eval(&format!("=ODDFPRICE({EXAMPLE})"));
        assert!((n(&v) - 113.5977).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn doc_example_basis0() {
        // Same dates on 30/360.
        let v = eval(
            "=ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2,0)",
        );
        assert!((n(&v) - 113.588).abs() < 2e-2, "{v:?}");
    }

    #[test]
    fn ordering_num() {
        // settlement <= issue violates maturity > first_coupon >
        // settlement > issue.
        let v = eval(
            "=ODDFPRICE(DATE(2008,10,1),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_rate_num() {
        let v = eval(
            "=ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),-0.05,0.0625,100,2)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_yield_num() {
        let v = eval(
            "=ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,-0.05,100,2)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_frequency_num() {
        let v = eval(
            "=ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,3)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_basis_num() {
        let v = eval(
            "=ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2,5)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn long_first_coupon() {
        // Issue > 6 months before first_coupon: quasi-coupon split.
        let v = eval(
            "=ODDFPRICE(DATE(2009,1,15),DATE(2021,3,1),DATE(2007,6,15),DATE(2009,3,1),0.0785,0.0625,100,2,0)",
        );
        let p = n(&v);
        assert!(p.is_finite() && p > 0.0, "{v:?}");
    }

    #[test]
    fn yield_zero_allowed() {
        let v = eval(
            "=ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0,100,2,0)",
        );
        assert!(n(&v).is_finite());
    }

    #[test]
    fn bad_text_value_error() {
        let v = eval(
            r#"=ODDFPRICE("x",DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2)"#,
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=ODDFPRICE(A1,DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ODDFPRICE(1,2,3,4,5,6,7)")), CalcError::Value);
    }
}
