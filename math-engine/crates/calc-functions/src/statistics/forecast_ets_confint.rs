//! `FORECAST.ETS.CONFINT(target_date, values, timeline,
//! [confidence_level], [seasonality], [data_completion],
//! [aggregation])` — half-width of the prediction interval around a
//! `FORECAST.ETS` forecast. Spec:
//! `docs/functions/FORECAST.ETS.CONFINT.md`.
//!
//! Width grows with the horizon: `z_{(1+c)/2} · RMSE · √h` on the
//! in-sample residual scale — a standard ETS-interval approximation,
//! NOT Excel's exact (undocumented) variance model, so numeric
//! fixtures are `specOpen`.

use crate::common::{coercion, ets, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 7) {
        return Ok(Value::Error(e));
    }
    let target = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };
    let confidence = match super::forecast_ets::opt_number(ctx, args, 3, 0.95)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(c) => c,
    };
    if !(confidence > 0.0 && confidence < 1.0) {
        return Ok(Value::Error(CalcError::Num));
    }
    let seasonality = match super::forecast_ets::opt_number(ctx, args, 4, 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => match ets::parse_seasonality(Some(s)) {
            Err(e) => return Ok(Value::Error(e)),
            Ok(s) => s,
        },
    };
    let data_completion = match super::forecast_ets::opt_number(ctx, args, 5, 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(d) => d.trunc(),
    };
    let aggregation = match super::forecast_ets::opt_number(ctx, args, 6, 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let prep = match super::forecast_ets::prepare_series(
        ctx,
        &args[1],
        &args[2],
        data_completion,
        aggregation,
    )? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    if target <= prep.last {
        return Ok(Value::Error(CalcError::Num));
    }
    let h = (target - prep.last) / prep.step;
    let fit = ets::fit(&prep.y, seasonality.period(&prep.y));
    let z = numerics::normal_inv((1.0 + confidence) / 2.0);
    Ok(Value::Number(z * fit.rmse * h.sqrt()))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn n(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            o => panic!("expected error, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn positive_width() {
        let v = n(&eval(
            "=FORECAST.ETS.CONFINT(13,{1,3,2,4,3,5},{1,2,3,4,5,6})",
        ));
        assert!(v > 0.0, "{v}");
    }

    #[test]
    fn width_grows_with_horizon() {
        let near = n(&eval(
            "=FORECAST.ETS.CONFINT(7,{1,3,2,4,3,5},{1,2,3,4,5,6})",
        ));
        let far = n(&eval(
            "=FORECAST.ETS.CONFINT(13,{1,3,2,4,3,5},{1,2,3,4,5,6})",
        ));
        assert!(far > near, "{near} vs {far}");
    }

    #[test]
    fn perfect_fit_zero_width() {
        // Constant series has zero residuals -> zero interval.
        assert_eq!(
            n(&eval("=FORECAST.ETS.CONFINT(5,{7,7,7,7},{1,2,3,4})")),
            0.0
        );
    }

    #[test]
    fn higher_confidence_wider() {
        let lo = n(&eval(
            "=FORECAST.ETS.CONFINT(7,{1,3,2,4,3,5},{1,2,3,4,5,6},0.8)",
        ));
        let hi = n(&eval(
            "=FORECAST.ETS.CONFINT(7,{1,3,2,4,3,5},{1,2,3,4,5,6},0.99)",
        ));
        assert!(hi > lo, "{lo} vs {hi}");
    }

    #[test]
    fn confidence_out_of_range_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.CONFINT(13,{1,2,3},{1,2,3},1.5)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=FORECAST.ETS.CONFINT(13,{1,2,3},{1,2,3},0)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=FORECAST.ETS.CONFINT(13,{1,2,3},{1,2,3},1)")),
            CalcError::Num
        );
    }

    #[test]
    fn irregular_step_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.CONFINT(13,{1,2,3,4},{1,2,3.3,4})")),
            CalcError::Num
        );
    }

    #[test]
    fn target_past_end_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.CONFINT(2,{1,2,3},{1,2,3})")),
            CalcError::Num
        );
    }

    #[test]
    fn length_mismatch_value() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.CONFINT(6,{1,2},{1,2,3})")),
            CalcError::Value
        );
    }

    #[test]
    fn non_numeric_confidence_value() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.CONFINT(6,{1,2,3},{1,2,3},\"x\")")),
            CalcError::Value
        );
    }

    #[test]
    fn ranges_form() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("A4", 4.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
                ("B4", 4.0.into()),
            ],
            "=FORECAST.ETS.CONFINT(6,A1:A4,B1:B4)",
        );
        assert!(matches!(v, Value::Number(_)), "{v:?}");
    }

    #[test]
    fn arity_checked() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.CONFINT(6,{1,2,3})")),
            CalcError::Value
        );
    }
}
