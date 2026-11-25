//! `ODDFYIELD(settlement, maturity, issue, first_coupon, rate, pr,
//! redemption, frequency, [basis])` — yield of a security with an odd
//! first coupon period. Spec: `docs/functions/ODDFYIELD.md`.
//!
//! No closed form: secant iteration on [`finance::oddf_price`]
//! `= pr`, mirroring Excel's Newton-style loop (~100 iterations;
//! ODDFYIELD.md open question on exact tolerance).

use crate::common::finance;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

/// Solve `oddf_price(y) = pr` for `y` via the secant method (the
/// derivative-free Newton used by Excel-documented reference
/// implementations). `None` on non-convergence -> `#NUM!`.
#[allow(clippy::too_many_arguments)]
fn solve_yield(
    settlement: i64,
    maturity: i64,
    issue: i64,
    first_coupon: i64,
    rate: f64,
    pr: f64,
    redemption: f64,
    frequency: i64,
    basis: finance::DayCountBasis,
    system: calc_core::workbook::DateSystem,
) -> Option<f64> {
    let f = |y: f64| {
        oddf_at(
            settlement,
            maturity,
            issue,
            first_coupon,
            rate,
            y,
            redemption,
            frequency,
            basis,
            system,
        ) - pr
    };
    // Secant seeds mirroring the reference (`x0 = 0`,
    // `x1 = x0·(1+1e-4) + 1e-4`).
    let (mut x0, mut x1) = (0.0f64, 1e-4f64);
    let mut f0 = f(x0);
    for _ in 0..100 {
        let f1 = f(x1);
        if !f1.is_finite() {
            return None;
        }
        if f1.abs() < 1e-10 || (x1 - x0).abs() < 1e-12 * (1.0 + x1.abs()) {
            return Some(x1);
        }
        let denom = f1 - f0;
        if denom == 0.0 {
            return None;
        }
        let x2 = x1 - f1 * (x1 - x0) / denom;
        if !x2.is_finite() {
            return None;
        }
        (x0, f0, x1) = (x1, f1, x2);
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn oddf_at(
    settlement: i64,
    maturity: i64,
    issue: i64,
    first_coupon: i64,
    rate: f64,
    yld: f64,
    redemption: f64,
    frequency: i64,
    basis: finance::DayCountBasis,
    system: calc_core::workbook::DateSystem,
) -> f64 {
    finance::oddf_price(
        settlement,
        maturity,
        issue,
        first_coupon,
        rate,
        yld,
        redemption,
        frequency,
        basis,
        system,
    )
    .unwrap_or(f64::NAN)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let (settlement, maturity, issue, first_coupon, rate, pr, redemption, frequency, basis) =
        match super::oddfprice::eval_args(ctx, args)? {
            Ok(t) => t,
            Err(e) => return Ok(Value::Error(e)),
        };
    if pr <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    match solve_yield(
        settlement,
        maturity,
        issue,
        first_coupon,
        rate,
        pr,
        redemption,
        frequency,
        basis,
        ctx.date_system(),
    ) {
        Some(v) => Ok(Value::Number(v)),
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

    const DATES: &str = "DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1)";

    #[test]
    fn doc_example() {
        // Inverse of the ODDFPRICE doc example: price 113.60 -> ~6.25%.
        let v = eval(&format!("=ODDFYIELD({DATES},0.0785,113.60,100,2,1)"));
        assert!((n(&v) - 0.0625).abs() < 1e-3, "{v:?}");
    }

    #[test]
    fn round_trip() {
        // ODDFYIELD(ODDFPRICE(y)) == y.
        let y = 0.0625f64;
        let p = eval(&format!("=ODDFPRICE({DATES},0.0785,{y},100,2,1)"));
        let back = eval(&format!("=ODDFYIELD({DATES},0.0785,{},100,2,1)", n(&p)));
        assert!((n(&back) - y).abs() < 1e-8, "{back:?}");
    }

    #[test]
    fn ordering_num() {
        let v = eval(
            "=ODDFYIELD(DATE(2008,10,1),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,100,100,2)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_rate_num() {
        let v = eval(&format!("=ODDFYIELD({DATES},-0.05,100,100,2)"));
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn zero_price_num() {
        let v = eval(&format!("=ODDFYIELD({DATES},0.0785,0,100,2)"));
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn negative_price_num() {
        let v = eval(&format!("=ODDFYIELD({DATES},0.0785,-100,100,2)"));
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_frequency_num() {
        let v = eval(&format!("=ODDFYIELD({DATES},0.0785,100,100,3)"));
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_basis_num() {
        let v = eval(&format!("=ODDFYIELD({DATES},0.0785,100,100,2,5)"));
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn extreme_price_nonconvergence_or_value() {
        // A price far outside any yield's range either converges to a
        // large yield or reports #NUM! — never panics/NaN.
        let v = eval(&format!("=ODDFYIELD({DATES},0.0785,0.0001,100,2)"));
        match v {
            Value::Number(x) => assert!(x.is_finite()),
            Value::Error(CalcError::Num) => {}
            o => panic!("unexpected {o:?}"),
        }
    }

    #[test]
    fn bad_text_value_error() {
        let v = eval(
            r#"=ODDFYIELD("x",DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,100,100,2)"#,
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=ODDFYIELD(A1,DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,100,100,2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ODDFYIELD(1,2,3,4,5,6,7)")), CalcError::Value);
    }
}
