//! `VDB(cost, salvage, life, start_period, end_period, [factor],
//! [no_switch])` — variable declining-balance depreciation over a
//! (possibly fractional) period interval.
//! Spec: `docs/functions/VDB.md`.
//!
//! Per-period charge is `book * factor/life` floored at `salvage`;
//! unless `no_switch`, it is `max`ed with straight-line on the
//! remaining depreciable basis `(book - salvage)/(life - elapsed)`
//! (the documented "switch to straight-line when larger" rule;
//! SPEC-OPEN: exact switch criterion granularity). Fractional
//! endpoints prorate the enclosing period's charge
//! (`VDB(...,0,0.5)` = half of year-1 charge, matching the spec's
//! worked example).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::{arg_num, opt_num};

/// Cumulative depreciation from period `0` to time `t`
/// (`0 <= t <= life`), linear within each period.
fn cum_dep(cost: f64, salvage: f64, life: f64, factor: f64, no_switch: bool, t: f64) -> f64 {
    let rate = factor / life;
    let mut book = cost;
    let mut dep = 0.0;
    let mut elapsed = 0.0;
    while elapsed < t {
        let frac = (t - elapsed).min(1.0);
        let room = (book - salvage).max(0.0);
        let ddb = (book * rate).min(room);
        let charge = if no_switch {
            ddb
        } else {
            // Straight line over the remaining life and basis.
            ddb.max(room / (life - elapsed)).min(room)
        };
        dep += charge * frac;
        book -= charge * frac;
        elapsed += 1.0;
    }
    dep
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 5, 7) {
        return Ok(Value::Error(e));
    }
    let cost = match arg_num(ctx, args, 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let salvage = match arg_num(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let life = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let start = match arg_num(ctx, args, 3)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let end = match arg_num(ctx, args, 4)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let factor = match opt_num(ctx, args, 5, 2.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let no_switch = match args.get(6) {
        Some(Expr::Missing) | None => false,
        Some(e) => match ctx.eval(e)?.to_boolean() {
            Ok(b) => b,
            Err(e) => return Ok(Value::Error(e)),
        },
    };
    if salvage < 0.0 || life <= 0.0 || start < 0.0 || end > life || end <= start || factor <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(
        cum_dep(cost, salvage, life, factor, no_switch, end)
            - cum_dep(cost, salvage, life, factor, no_switch, start),
    ))
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
    fn spec_year_one() {
        // 2400 * 0.2.
        assert_eq!(n(&eval("=VDB(2400,300,10,0,1)")), 480.0);
    }

    #[test]
    fn spec_year_two() {
        // (2400-480)*0.2.
        assert_eq!(n(&eval("=VDB(2400,300,10,1,2)")), 384.0);
    }

    #[test]
    fn spec_half_year() {
        assert_eq!(n(&eval("=VDB(2400,300,10,0,0.5)")), 240.0);
    }

    #[test]
    fn spec_full_life() {
        // Capped at salvage: total = cost - salvage.
        let got = n(&eval("=VDB(2400,300,10,0,10)"));
        assert!((got - 2100.0).abs() < 1e-9, "got {got}");
    }

    #[test]
    fn spec_inverted_periods_num() {
        assert_eq!(e(&eval("=VDB(2400,300,10,2,1)")), CalcError::Num);
    }

    #[test]
    fn switch_to_straight_line() {
        // factor=1.5 over 5y on (1000,100): DDB wins periods 1-3,
        // SL (121.5) wins periods 4-5 -> total 900.
        let got = n(&eval("=VDB(1000,100,5,0,5,1.5,FALSE)"));
        assert!((got - 900.0).abs() < 1e-9, "got {got}");
        // no_switch=TRUE keeps declining balance (short of salvage).
        let got_ns = n(&eval("=VDB(1000,100,5,0,5,1.5,TRUE)"));
        assert!(
            (got_ns - (1000.0 * (1.0 - 0.7f64.powi(5)))).abs() < 1e-9,
            "got {got_ns}"
        );
    }

    #[test]
    fn factor_one_declining() {
        // factor=1: 1000*0.1 = 100 first year.
        assert_eq!(n(&eval("=VDB(1000,0,10,0,1,1,TRUE)")), 100.0);
    }

    #[test]
    fn fractional_start_and_end() {
        // Interval [0.5, 1.5] = 0.5*480 + 0.5*384 = 432.
        assert_eq!(n(&eval("=VDB(2400,300,10,0.5,1.5)")), 432.0);
    }

    #[test]
    fn life_zero_num() {
        assert_eq!(e(&eval("=VDB(2400,300,0,0,1)")), CalcError::Num);
    }

    #[test]
    fn salvage_negative_num() {
        assert_eq!(e(&eval("=VDB(2400,-1,10,0,1)")), CalcError::Num);
    }

    #[test]
    fn start_negative_num() {
        assert_eq!(e(&eval("=VDB(2400,300,10,-1,1)")), CalcError::Num);
    }

    #[test]
    fn end_beyond_life_num() {
        assert_eq!(e(&eval("=VDB(2400,300,10,0,11)")), CalcError::Num);
    }

    #[test]
    fn factor_zero_num() {
        assert_eq!(e(&eval("=VDB(2400,300,10,0,1,0)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(e(&eval(r#"=VDB(2400,"x",10,0,1)"#)), CalcError::Value);
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=VDB(2400,300,10,A1,1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
