//! `DB(cost, salvage, life, period, [month])` — fixed-declining-balance
//! depreciation. Spec: `docs/functions/DB.md`.
//!
//! Replicates the documented Excel quirk: the rate is
//! `round(1 - (salvage/cost)^(1/life), 3)` — rounded to three decimals
//! — so `DB` diverges from exact declining-balance math. `period`,
//! `life` and `month` truncate to integers; `period = life + 1` is the
//! final stub (only meaningful when `month < 12`).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_serial::trunc_to_i64;

use super::{number_arg, opt_number_arg};

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
    let life = trunc_to_i64(take!(number_arg(ctx, args, 2)));
    let period = trunc_to_i64(take!(number_arg(ctx, args, 3)));
    let month = trunc_to_i64(take!(opt_number_arg(ctx, args, 4, 12.0)));
    if cost <= 0.0
        || salvage < 0.0
        || salvage > cost
        || life <= 0
        || period <= 0
        || period > life + 1
        || !(1..=12).contains(&month)
    {
        return Ok(Value::Error(CalcError::Num));
    }
    let rate = ((1.0 - (salvage / cost).powf(1.0 / life as f64)) * 1000.0).round() / 1000.0;
    let first = cost * rate * month as f64 / 12.0;
    if period == 1 {
        return Ok(Value::Number(first));
    }
    let mut acc = first;
    let mut dep = first;
    for _ in 2..=period.min(life) {
        dep = (cost - acc) * rate;
        acc += dep;
    }
    if period > life {
        dep = (cost - acc) * rate * (12 - month) as f64 / 12.0;
    }
    Ok(Value::Number(dep))
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
        // rate = round(1-(100000/1000000)^(1/6),3) = 0.319.
        assert!((n(&eval("=DB(1000000,100000,6,1,7)")) - 186083.33).abs() < 0.01);
        assert!((n(&eval("=DB(1000000,100000,6,2,7)")) - 259639.42).abs() < 0.01);
        assert!((n(&eval("=DB(1000000,100000,6,7,7)")) - 15845.10).abs() < 0.01);
        assert!((n(&eval("=DB(1000000,100000,6,1)")) - 319000.0).abs() < 1e-6);
        assert_eq!(e(&eval("=DB(1000000,100000,6,8,7)")), CalcError::Num);
    }

    #[test]
    fn stub_last_period() {
        // With month=7 the life+1 stub is the remaining 5/12 of the
        // final year's declining charge: (cost - acc_6) * rate * 5/12.
        let deps: Vec<f64> = (1..=6)
            .map(|p| n(&eval(&format!("=DB(1000000,100000,6,{p},7)"))))
            .collect();
        let acc6: f64 = deps.iter().sum();
        let stub = n(&eval("=DB(1000000,100000,6,7,7)"));
        assert!((stub - (1_000_000.0 - acc6) * 0.319 * 5.0 / 12.0).abs() < 0.01);
    }

    #[test]
    fn period_life_plus_one_full_year_zero() {
        // month=12: stub factor is 0 -> zero depreciation.
        assert_eq!(n(&eval("=DB(1000000,100000,6,7,12)")), 0.0);
        assert_eq!(n(&eval("=DB(1000000,100000,6,7)")), 0.0);
    }

    #[test]
    fn month_boundaries() {
        assert_eq!(e(&eval("=DB(1000,100,5,1,0)")), CalcError::Num);
        assert_eq!(e(&eval("=DB(1000,100,5,1,13)")), CalcError::Num);
        // Truncates.
        assert_eq!(
            n(&eval("=DB(1000,100,5,1,12.9)")),
            n(&eval("=DB(1000,100,5,1,12)"))
        );
    }

    #[test]
    fn salvage_equal_cost_zero_depreciation() {
        // rate rounds to 0 -> all periods zero (salvage > cost is #NUM!).
        assert_eq!(n(&eval("=DB(1000,1000,5,1)")), 0.0);
        assert_eq!(e(&eval("=DB(1000,1001,5,1)")), CalcError::Num);
    }

    #[test]
    fn invalid_cost_life_period_num() {
        assert_eq!(e(&eval("=DB(0,100,5,1)")), CalcError::Num);
        assert_eq!(e(&eval("=DB(-1,100,5,1)")), CalcError::Num);
        assert_eq!(e(&eval("=DB(1000,-1,5,1)")), CalcError::Num);
        assert_eq!(e(&eval("=DB(1000,100,0,1)")), CalcError::Num);
        assert_eq!(e(&eval("=DB(1000,100,5,0)")), CalcError::Num);
    }

    #[test]
    fn period_truncates() {
        assert_eq!(
            n(&eval("=DB(1000000,100000,6,2.9,7)")),
            n(&eval("=DB(1000000,100000,6,2,7)"))
        );
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(e(&eval(r#"=DB("x",100,5,1)"#)), CalcError::Value);
    }

    #[test]
    fn blank_month_defaults_12() {
        assert_eq!(
            n(&eval("=DB(1000000,100000,6,1,)")),
            n(&eval("=DB(1000000,100000,6,1,12)"))
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DB(1/0,100,5,1)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DB(1,2,3)")), CalcError::Value);
        assert_eq!(e(&eval("=DB(1,2,3,4,5,6)")), CalcError::Value);
    }
}
