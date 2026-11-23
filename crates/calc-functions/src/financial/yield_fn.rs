//! `YIELD(settlement, maturity, rate, pr, redemption, frequency,
//! [basis])` — yield to maturity of a periodic-interest security.
//! Spec: `docs/functions/YIELD.md`.
//!
//! Settlement in the final coupon period uses the documented closed
//! form `((R/100 + r/f) - (P/100 + A/E·r/f)) · f·E/DSR`. Otherwise the
//! yield solves `PRICE(y) = pr` over the coupon schedule: cash flows
//! `100·r/f` at fractional times `k-1+DSC/E` plus `redemption` at the
//! last are equated to the dirty target `pr + accrued`, where
//! `accrued = 100·r/f·A/E` — an NPV-zero solved by
//! [`finance::solve_rate`], annualized as `r·f` (bond-equivalent
//! convention). File named `yield_fn.rs` because `yield` is a Rust
//! keyword (same convention as `logical/if_fn.rs`).

use crate::common::finance::{self, DayCountBasis};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;
use calc_core::workbook::DateSystem;

use super::{arg_basis, arg_date, arg_num};

/// Scalar inputs of `solve_yield` (keeps the signature small).
struct YieldInputs {
    rate: f64,
    pr: f64,
    redemption: f64,
    frequency: i64,
    basis: DayCountBasis,
    settlement: i64,
    system: DateSystem,
}

/// Solve for the annual yield (bond-equivalent: `r_per * frequency`).
fn solve_yield(inp: &YieldInputs, sched: &finance::CouponSchedule) -> Option<f64> {
    let &YieldInputs {
        rate,
        pr,
        redemption,
        frequency,
        basis,
        settlement,
        system,
    } = inp;
    let f = frequency as f64;
    let e = finance::coupon_period_days(basis, frequency, sched.pcd, sched.ncd, system)?;
    let a = finance::days_between(sched.pcd, settlement, basis, system)? as f64;
    let dsc = finance::days_between(settlement, sched.ncd, basis, system)? as f64;
    let n = sched.remaining;
    let coupon = 100.0 * rate / f;
    if n == 1 {
        // Closed form for the final coupon period.
        let dsr = dsc; // ncd == maturity here
        return Some(
            ((redemption / 100.0 + rate / f) - (pr / 100.0 + (a / e) * (rate / f))) * f * e / dsr,
        );
    }
    let dirty = pr + coupon * a / e;
    let mut times = Vec::with_capacity(n as usize + 1);
    let mut amounts = Vec::with_capacity(n as usize + 1);
    times.push(0.0);
    amounts.push(-dirty);
    for k in 1..=n {
        times.push((k - 1) as f64 + dsc / e);
        amounts.push(coupon + if k == n { redemption } else { 0.0 });
    }
    Some(finance::solve_rate(&times, &amounts, 0.1)? * f)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 6, 7) {
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
    let rate = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let pr = match arg_num(ctx, args, 3)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let redemption = match arg_num(ctx, args, 4)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let frequency = match arg_num(ctx, args, 5)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => crate::common::date_serial::trunc_to_i64(v),
    };
    let basis = match arg_basis(ctx, args, 6)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if settlement >= maturity
        || rate < 0.0
        || pr <= 0.0
        || redemption <= 0.0
        || finance::months_per_period(frequency).is_none()
    {
        return Ok(Value::Error(CalcError::Num));
    }
    let sched = match finance::coupon_schedule(settlement, maturity, frequency, ctx.date_system()) {
        Some(s) => s,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    let inp = YieldInputs {
        rate,
        pr,
        redemption,
        frequency,
        basis,
        settlement,
        system: ctx.date_system(),
    };
    match solve_yield(&inp, &sched) {
        Some(y) if y.is_finite() => Ok(Value::Number(y)),
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
        // Documented example: settle 2008-02-15 (39493), maturity
        // 2016-11-15 (42689), coupon 5.75%, pr 95.04287, freq 2,
        // basis 0 -> 6.5%.
        let got = n(&eval("=YIELD(39493,42689,0.0575,95.04287,100,2,0)"));
        assert!((got - 0.065).abs() < 1e-4, "got {got}");
    }

    #[test]
    fn par_bond_yields_coupon_rate() {
        // Settlement exactly on a coupon date of a par bond:
        // 45000 = 2023-03-15; maturity 46096 = 2026-03-15 (annual
        // coupons on 03-15) -> y = rate.
        let got = n(&eval("=YIELD(45000,46096,0.10,100,100,1,0)"));
        assert!((got - 0.10).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn premium_bond_lower_yield() {
        // Price > par -> yield < coupon.
        let par = n(&eval("=YIELD(45000,46096,0.10,100,100,1,0)"));
        let prem = n(&eval("=YIELD(45000,46096,0.10,110,100,1,0)"));
        assert!(prem < par && prem > 0.0, "prem {prem}");
    }

    #[test]
    fn discount_bond_higher_yield() {
        let got = n(&eval("=YIELD(45000,46096,0.10,90,100,1,0)"));
        assert!(got > 0.10, "got {got}");
    }

    #[test]
    fn single_period_closed_form() {
        // One coupon period left: settlement = pcd so A = 0, DSC = E.
        // ((1 + 0.05) - 0.95) * 1 * E/DSR; on coupon date DSR = E
        // -> y = 0.10? Actually (105/100... compute: ((1.0+0.05)-0.95)
        // * f * E/DSR = 0.10 * 1 * 1 = 0.10.
        // settlement 46096 (2026-03-15), maturity 46461 (2027-03-15),
        // annual freq -> remaining = 1.
        let got = n(&eval("=YIELD(46096,46461,0.05,95,100,1,0)"));
        assert!((got - 0.10).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn frequency_two() {
        let got = n(&eval("=YIELD(45000,46096,0.10,100,100,2,0)"));
        // Par bond still prices at coupon rate for freq 2.
        assert!((got - 0.10).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn dates_equal_num() {
        assert_eq!(
            e(&eval("=YIELD(45000,45000,0.05,100,100,2)")),
            CalcError::Num
        );
    }

    #[test]
    fn rate_negative_num() {
        assert_eq!(
            e(&eval("=YIELD(45000,46096,-0.05,100,100,2)")),
            CalcError::Num
        );
    }

    #[test]
    fn pr_zero_num() {
        assert_eq!(e(&eval("=YIELD(45000,46096,0.05,0,100,2)")), CalcError::Num);
    }

    #[test]
    fn frequency_invalid_num() {
        assert_eq!(
            e(&eval("=YIELD(45000,46096,0.05,100,100,3)")),
            CalcError::Num
        );
    }

    #[test]
    fn basis_out_of_range_num() {
        assert_eq!(
            e(&eval("=YIELD(45000,46096,0.05,100,100,2,5)")),
            CalcError::Num
        );
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(
            e(&eval(r#"=YIELD(45000,46096,0.05,"x",100,2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=YIELD(45000,46096,A1,100,100,2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
