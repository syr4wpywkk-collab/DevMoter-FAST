//! `FORECAST.ETS.STAT(values, timeline, statistic_type,
//! [seasonality], [data_completion], [aggregation])` — one of the
//! eight ETS model statistics (`1` alpha, `2` beta, `3` gamma,
//! `4` MASE, `5` SMAPE, `6` MAE, `7` RMSE, `8` timeline step).
//! Spec: `docs/functions/FORECAST.ETS.STAT.md`.
//!
//! `statistic_type` outside `1..=8` is `#NUM!` (the spec's kind
//! question). Accuracy metrics come from the fitted model's
//! one-step residuals; optimizer parity with Excel is not guaranteed
//! — numeric fixtures are `specOpen`.

use crate::common::{coercion, ets};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 6) {
        return Ok(Value::Error(e));
    }
    let stat_type = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => s.trunc(),
    };
    if !(1.0..=8.0).contains(&stat_type) {
        return Ok(Value::Error(CalcError::Num));
    }
    let seasonality = match super::forecast_ets::opt_number(ctx, args, 3, 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => match ets::parse_seasonality(Some(s)) {
            Err(e) => return Ok(Value::Error(e)),
            Ok(s) => s,
        },
    };
    let data_completion = match super::forecast_ets::opt_number(ctx, args, 4, 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(d) => d.trunc(),
    };
    let aggregation = match super::forecast_ets::opt_number(ctx, args, 5, 1.0)? {
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
    if stat_type == 8.0 {
        return Ok(Value::Number(prep.step));
    }
    let fit = ets::fit(&prep.y, seasonality.period(&prep.y));
    let v = match stat_type as u8 {
        1 => fit.alpha,
        2 => fit.beta,
        3 => fit.gamma,
        4 => fit.mase,
        5 => fit.smape,
        6 => fit.mae,
        _ => fit.rmse,
    };
    Ok(Value::Number(v))
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
    fn step_size() {
        assert_eq!(
            n(&eval(
                "=FORECAST.ETS.STAT({1,2,3,4,5,6,7,8,9,10,11,12},{1,2,3,4,5,6,7,8,9,10,11,12},8)"
            )),
            1.0
        );
    }

    #[test]
    fn step_size_nonunit() {
        assert_eq!(n(&eval("=FORECAST.ETS.STAT({1,2,3},{2,4,6},8)")), 2.0);
    }

    #[test]
    fn alpha_in_unit_interval() {
        let v = n(&eval("=FORECAST.ETS.STAT({1,2,3,4,5,6},{1,2,3,4,5,6},1)"));
        assert!((0.0..=1.0).contains(&v), "{v}");
    }

    #[test]
    fn beta_in_unit_interval() {
        let v = n(&eval("=FORECAST.ETS.STAT({1,2,3,4,5,6},{1,2,3,4,5,6},2)"));
        assert!((0.0..=1.0).contains(&v), "{v}");
    }

    #[test]
    fn gamma_in_unit_interval() {
        let v = n(&eval("=FORECAST.ETS.STAT({1,2,1,2,1,2},{1,2,3,4,5,6},3)"));
        assert!((0.0..=1.0).contains(&v), "{v}");
    }

    #[test]
    fn rmse_zero_for_perfect_fit() {
        assert_eq!(n(&eval("=FORECAST.ETS.STAT({7,7,7,7},{1,2,3,4},7)")), 0.0);
    }

    #[test]
    fn mae_nonneg() {
        let v = n(&eval("=FORECAST.ETS.STAT({1,3,2,4,3,5},{1,2,3,4,5,6},6)"));
        assert!(v >= 0.0, "{v}");
    }

    #[test]
    fn stat_type_out_of_range_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.STAT({1,2,3},{1,2,3},9)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=FORECAST.ETS.STAT({1,2,3},{1,2,3},0)")),
            CalcError::Num
        );
    }

    #[test]
    fn stat_type_truncated() {
        assert_eq!(n(&eval("=FORECAST.ETS.STAT({1,2,3},{2,4,6},8.9)")), 2.0);
    }

    #[test]
    fn irregular_step_num() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.STAT({1,2,3,4},{1,2,3.3,4},1)")),
            CalcError::Num
        );
    }

    #[test]
    fn length_mismatch_value() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.STAT({1,2},{1,2,3},1)")),
            CalcError::Value
        );
    }

    #[test]
    fn non_numeric_stat_type_value() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.STAT({1,2,3},{1,2,3},\"x\")")),
            CalcError::Value
        );
    }

    #[test]
    fn arity_checked() {
        assert_eq!(
            e(&eval("=FORECAST.ETS.STAT({1,2,3},{1,2,3})")),
            CalcError::Value
        );
    }
}
