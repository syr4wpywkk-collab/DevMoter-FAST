//! `DDB(cost, salvage, life, period, [factor])` — declining-balance
//! depreciation with an arbitrary rate multiplier (default `2`).
//! Spec: `docs/functions/DDB.md`.
//!
//! Follows the reference (LibreOffice/Excel) form: `rate =
//! factor/life` (clamped to 1); period `p` depreciates
//! `old - max(new, salvage)` where `old = cost*(1-rate)^(p-1)` and
//! `new = cost*(1-rate)^p`, floored at 0. `period` is *not* truncated —
//! fractional periods interpolate through the power law (this resolves
//! the spec's open question toward the LibreOffice semantics).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::{number_arg, opt_number_arg};

fn ddb(cost: f64, salvage: f64, life: f64, period: f64, factor: f64) -> f64 {
    let mut rate = factor / life;
    let old = if rate >= 1.0 {
        rate = 1.0;
        if period == 1.0 { cost } else { 0.0 }
    } else {
        cost * (1.0 - rate).powf(period - 1.0)
    };
    let new = cost * (1.0 - rate).powf(period);
    (old - new.max(salvage)).max(0.0)
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 5) {
        return Ok(Value::Error(e));
    }
    macro_rules! take {
        ($e:expr) => {
            match $e? {
                Ok(v) => v,
                Err(e) => return Ok(Value::Error(e)),
            }
        };
    }
    let cost = take!(number_arg(ctx, args, 0));
    let salvage = take!(number_arg(ctx, args, 1));
    let life = take!(number_arg(ctx, args, 2));
    let period = take!(number_arg(ctx, args, 3));
    let factor = take!(opt_number_arg(ctx, args, 4, 2.0));
    if cost < 0.0
        || salvage < 0.0
        || salvage > cost
        || life <= 0.0
        || period < 1.0
        || period > life
        || factor <= 0.0
    {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(ddb(cost, salvage, life, period, factor)))
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
    fn spec_examples() {
        assert_eq!(n(&eval("=DDB(2400,300,10,1,2)")), 480.0);
        assert!((n(&eval("=DDB(2400,300,10,10,2)")) - 22.1225472).abs() < 1e-6);
        assert!((n(&eval("=DDB(2400,300,3650,1,2)")) - 1.315068493).abs() < 1e-7);
        assert!((n(&eval("=DDB(2400,300,120,1,2)")) - 40.0).abs() < 1e-9);
        assert_eq!(n(&eval("=DDB(2400,300,10,1,1.5)")), 360.0);
        assert_eq!(e(&eval("=DDB(2400,300,10,11)")), CalcError::Num);
    }

    #[test]
    fn factor_default_two() {
        assert_eq!(
            n(&eval("=DDB(2400,300,10,1)")),
            n(&eval("=DDB(2400,300,10,1,2)"))
        );
    }

    #[test]
    fn salvage_floor() {
        // Fully depreciated before the floor: result never pushes book
        // value below salvage.
        assert_eq!(n(&eval("=DDB(2400,2399,10,10,2)")), 0.0);
    }

    #[test]
    fn rate_clamped_at_one() {
        // factor >= life: everything goes in period 1.
        assert_eq!(n(&eval("=DDB(2400,300,2,1,2)")), 2100.0);
        assert_eq!(n(&eval("=DDB(2400,300,2,2,2)")), 0.0);
    }

    #[test]
    fn fractional_period() {
        // period is a real number (power-law interpolation).
        let v = n(&eval("=DDB(2400,300,10,1.5,2)"));
        assert!(v > 0.0 && v < 480.0);
    }

    #[test]
    fn period_zero_and_negative_num() {
        assert_eq!(e(&eval("=DDB(2400,300,10,0)")), CalcError::Num);
        assert_eq!(e(&eval("=DDB(2400,300,10,-1)")), CalcError::Num);
    }

    #[test]
    fn invalid_inputs_num() {
        assert_eq!(e(&eval("=DDB(-1,300,10,1)")), CalcError::Num);
        assert_eq!(e(&eval("=DDB(2400,-1,10,1)")), CalcError::Num);
        assert_eq!(e(&eval("=DDB(2400,2500,10,1)")), CalcError::Num);
        assert_eq!(e(&eval("=DDB(2400,300,10,1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=DDB(2400,300,10,1,-2)")), CalcError::Num);
        assert_eq!(e(&eval("=DDB(2400,300,0,1)")), CalcError::Num);
    }

    #[test]
    fn zero_cost() {
        assert_eq!(n(&eval("=DDB(0,0,10,1)")), 0.0);
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(e(&eval(r#"=DDB("x",300,10,1)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DDB(1/0,300,10,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DDB(1,2,3)")), CalcError::Value);
        assert_eq!(e(&eval("=DDB(1,2,3,4,5,6)")), CalcError::Value);
    }
}
