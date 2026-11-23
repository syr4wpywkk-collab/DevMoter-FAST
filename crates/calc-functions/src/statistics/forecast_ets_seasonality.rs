//! `FORECAST.ETS.SEASONALITY(values, timeline, [data_completion],
//! [aggregation])` — the seasonal period `FORECAST.ETS` would detect.
//! Spec: `docs/functions/FORECAST.ETS.SEASONALITY.md`.
//!
//! Returns the period in steps (e.g. `12` for monthly seasonality,
//! `0` when none is detected) — the spec's units question; numeric
//! output is detection-algorithm dependent so fixtures are
//! `specOpen`.

use crate::common::ets;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 4) {
        return Ok(Value::Error(e));
    }
    let data_completion = match super::forecast_ets::opt_number(ctx, args, 2, 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(d) => d.trunc(),
    };
    let aggregation = match super::forecast_ets::opt_number(ctx, args, 3, 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let prep = match super::forecast_ets::prepare_series(
        ctx,
        &args[0],
        &args[1],
        data_completion,
        aggregation,
    )? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    Ok(Value::Number(ets::detect_seasonality(&prep.y) as f64))
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
    fn alternating_series_period_two() {
        // SPEC-OPEN: detection output must be verified against Excel.
        assert_eq!(
            n(&eval(
                "=FORECAST.ETS.SEASONALITY({1,2,1,2,1,2,1,2},{1,2,3,4,5,6,7,8})"
            )),
            2.0
        );
    }

    #[test]
    fn period_four() {
        let v = n(&eval(
            "=FORECAST.ETS.SEASONALITY({1,2,3,4,1,2,3,4},{1,2,3,4,5,6,7,8})",
        ));
        assert_eq!(v, 4.0);
    }

    #[test]
    fn pure_trend_no_seasonality() {
        // Monotone series has no autocorrelation local maximum.
        assert_eq!(
            n(&eval(
                "=FORECAST.ETS.SEASONALITY({1,2,3,4,5,6},{1,2,3,4,5,6})"
            )),
            0.0
        );
    }

    #[test]
    fn constant_no_seasonality() {
        assert_eq!(
            n(&eval("=FORECAST.ETS.SEASONALITY({7,7,7,7},{1,2,3,4})")),
            0.0
        );
    }

    #[test]
    fn short_series_no_seasonality() {
        // Fewer than two full cycles possible.
        assert_eq!(n(&eval("=FORECAST.ETS.SEASONALITY({1,2,3},{1,2,3})")), 0.0);
    }

    #[test]
    fn irregular_step_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.SEASONALITY({1,2,3,4},{1,2,3.3,4})")),
            CalcError::Num
        );
    }

    #[test]
    fn length_mismatch_value() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.SEASONALITY({1,2},{1,2,3})")),
            CalcError::Value
        );
    }

    #[test]
    fn too_few_points_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.SEASONALITY({1,2},{1,2})")),
            CalcError::Num
        );
    }

    #[test]
    fn invalid_data_completion_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.SEASONALITY({1,2,3,4},{1,2,3,4},3)")),
            CalcError::Num
        );
    }

    #[test]
    fn invalid_aggregation_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.SEASONALITY({1,2,3,4},{1,2,3,4},1,8)")),
            CalcError::Num
        );
    }

    #[test]
    fn ranges_form() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 1.0.into()),
                ("A4", 2.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
                ("B4", 4.0.into()),
            ],
            "=FORECAST.ETS.SEASONALITY(A1:A4,B1:B4)",
        );
        assert!(matches!(v, Value::Number(_)), "{v:?}");
    }

    #[test]
    fn arity_checked() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.SEASONALITY({1,2,3})")),
            CalcError::Value
        );
    }
}
