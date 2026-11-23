//! `FORECAST.ETS(target_date, values, timeline, [seasonality],
//! [data_completion], [aggregation])` — ETS AAA point forecast.
//! Spec: `docs/functions/FORECAST.ETS.md`.
//!
//! The heavy lifting (timeline validation/gap-filling, seasonality
//! detection, Holt-Winters fit) lives in [`crate::common::ets`].
//! Excel's parameter optimizer is undocumented, so numeric parity with
//! Excel is not guaranteed — ETS fixture cases are `specOpen`.

use crate::common::{coercion, ets, statistics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Shared `(values, timeline)` + `data_completion` + `aggregation`
/// handling for the `FORECAST.ETS*` family: evaluates the two series
/// arguments (non-numeric members ignored, errors propagate), checks
/// length parity (`#VALUE!` — SPEC-OPEN vs `#N/A`), collapses
/// duplicate timeline points via `aggregation`, and expands to the
/// step grid.
pub(crate) fn prepare_series(
    ctx: &mut EvalContext<'_>,
    values: &Expr,
    timeline: &Expr,
    data_completion: f64,
    aggregation: f64,
) -> Result<Result<ets::Prepared, CalcError>, EvalError> {
    let y = match statistics::array_numbers(ctx, values)? {
        Err(e) => return Ok(Err(e)),
        Ok(y) => y,
    };
    let t = match statistics::array_numbers(ctx, timeline)? {
        Err(e) => return Ok(Err(e)),
        Ok(t) => t,
    };
    if y.len() != t.len() {
        return Ok(Err(CalcError::Value));
    }
    let (t, y) = match ets::aggregate(&t, &y, aggregation) {
        Err(e) => return Ok(Err(e)),
        Ok(v) => v,
    };
    Ok(ets::prepare(&t, &y, data_completion))
}

/// Optional numeric argument (omitted when `args` is short): direct
/// scalar coercion, so non-numeric is `#VALUE!`.
pub(crate) fn opt_number(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    index: usize,
    default: f64,
) -> Result<Result<f64, CalcError>, EvalError> {
    if args.len() <= index {
        return Ok(Ok(default));
    }
    coercion::eval_number(ctx, &args[index])
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 6) {
        return Ok(Value::Error(e));
    }
    let target = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };
    let seasonality = match opt_number(ctx, args, 3, 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => match ets::parse_seasonality(Some(s)) {
            Err(e) => return Ok(Value::Error(e)),
            Ok(s) => s,
        },
    };
    let data_completion = match opt_number(ctx, args, 4, 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(d) => d.trunc(),
    };
    let aggregation = match opt_number(ctx, args, 5, 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let prep = match prepare_series(ctx, &args[1], &args[2], data_completion, aggregation)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    if target <= prep.last {
        return Ok(Value::Error(CalcError::Num));
    }
    let h = (target - prep.last) / prep.step;
    let m = seasonality.period(&prep.y);
    let fit = ets::fit(&prep.y, m);
    Ok(Value::Number(fit.forecast(h)))
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
    fn linear_trend_forecasts_ahead() {
        // y = x: forecast near 13 (ETS output is not closed-form; the
        // trend is exact enough that a wide band holds).
        let v = n(&eval(
            "=FORECAST.ETS(13,{1,2,3,4,5,6,7,8,9,10,11,12},{1,2,3,4,5,6,7,8,9,10,11,12})",
        ));
        assert!((v - 13.0).abs() < 0.5, "{v}");
    }

    #[test]
    fn constant_series() {
        assert!((n(&eval("=FORECAST.ETS(5,{7,7,7,7},{1,2,3,4})")) - 7.0).abs() < 1e-9);
    }

    #[test]
    fn target_not_past_end_num() {
        assert_eq!(e(&eval("=FORECAST.ETS(2,{1,2,3},{1,2,3})")), CalcError::Num);
        assert_eq!(e(&eval("=FORECAST.ETS(3,{1,2,3},{1,2,3})")), CalcError::Num);
    }

    #[test]
    fn irregular_step_num() {
        // {1,3,4} is a *missing-point* timeline (gaps are multiples of the
        // inferred step 1); a non-multiple gap is the irregular case.
        assert_eq!(
            e(&eval("=FORECAST.ETS(6,{1,2,3,4},{1,2,3.3,4})")),
            CalcError::Num
        );
    }

    #[test]
    fn length_mismatch_value() {
        assert_eq!(e(&eval("=FORECAST.ETS(6,{1,2},{1,2,3})")), CalcError::Value);
    }

    #[test]
    fn too_few_points_num() {
        assert_eq!(e(&eval("=FORECAST.ETS(6,{1,2},{1,2})")), CalcError::Num);
    }

    #[test]
    fn negative_seasonality_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS(6,{1,2,3,4},{1,2,3,4},-1)")),
            CalcError::Num
        );
    }

    #[test]
    fn fixed_seasonality() {
        // m = 2 on an alternating series: next value after ...1,2 is 1.
        let v = n(&eval(
            "=FORECAST.ETS(9,{1,2,1,2,1,2,1,2},{1,2,3,4,5,6,7,8},2)",
        ));
        assert!(v > 0.0, "{v}");
    }

    #[test]
    fn no_seasonality_zero() {
        let v = n(&eval("=FORECAST.ETS(5,{1,2,3,4},{1,2,3,4},0)"));
        assert!(v > 4.0, "{v}");
    }

    #[test]
    fn data_completion_zero_fills_gaps() {
        // Missing t=3 zero-filled; still returns a number.
        let v = eval("=FORECAST.ETS(6,{1,2,4,5},{1,2,4,5},0,0)");
        assert!(matches!(v, Value::Number(_)), "{v:?}");
    }

    #[test]
    fn invalid_data_completion_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS(6,{1,2,3,4},{1,2,3,4},0,2)")),
            CalcError::Num
        );
    }

    #[test]
    fn aggregation_collapses_duplicates() {
        // Duplicate t=2 aggregated (SUM): series 1, 5, 4 on t 1,2,3.
        let v = eval("=FORECAST.ETS(5,{1,2,3,4},{1,2,2,3},0,1,7)");
        assert!(matches!(v, Value::Number(_)), "{v:?}");
    }

    #[test]
    fn invalid_aggregation_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS(6,{1,2,3,4},{1,2,3,4},0,1,9)")),
            CalcError::Num
        );
    }

    #[test]
    fn non_numeric_target_value() {
        assert_eq!(
            e(&eval("=FORECAST.ETS(\"x\",{1,2,3},{1,2,3})")),
            CalcError::Value
        );
    }
}
