//! `FORECAST(x, known_ys, known_xs)` — least-squares linear prediction
//! `a + b*x` with `b = sxy/sxx`, `a = ȳ - b*x̄`. Spec:
//! `docs/functions/FORECAST.md` (identical to `FORECAST.LINEAR`).
//!
//! Pair handling matches `SLOPE`: pairs are dropped when either member
//! is non-numeric, member-count mismatch is `#N/A`, and zero
//! x-variance (or no usable pairs) is `#DIV/0!`.

use crate::common::{coercion, statistics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub(crate) fn forecast_inner(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let x = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(x) => x,
    };
    // numeric_pairs takes (x-side, y-side).
    let pairs = match statistics::numeric_pairs(ctx, &args[2], &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    let st = statistics::pair_stats(&pairs);
    if pairs.is_empty() || st.sxx == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(st.mean_y + st.sxy / st.sxx * (x - st.mean_x)))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    forecast_inner(ctx, args)
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
    fn spec_example() {
        assert!(
            (n(&eval("=FORECAST(30,{6,7,9,15,21},{20,28,31,38,40})")) - 10.607_253_086_419_76)
                .abs()
                < 1e-12
        );
    }

    #[test]
    fn perfect_line() {
        assert_eq!(n(&eval("=FORECAST(0,{1,2,3},{1,2,3})")), 0.0);
    }

    #[test]
    fn scaled_line() {
        // y = 2x: forecast at x=10 is 20.
        assert_eq!(n(&eval("=FORECAST(10,{2,4,6},{1,2,3})")), 20.0);
    }

    #[test]
    fn size_mismatch_na() {
        assert_eq!(e(&eval("=FORECAST(5,{1,2},{1})")), CalcError::NA);
    }

    #[test]
    fn zero_x_variance_div_zero() {
        assert_eq!(e(&eval("=FORECAST(5,{1,2,3},{7,7,7})")), CalcError::DivZero);
    }

    #[test]
    fn empty_pairs_div_zero() {
        let v = eval_with(&[("A1", "x".into())], "=FORECAST(5,A1:A1,A1:A1)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn non_numeric_x_value() {
        assert_eq!(e(&eval("=FORECAST(\"x\",{1,2},{1,2})")), CalcError::Value);
    }

    #[test]
    fn text_pair_dropped() {
        // B2 text drops pair 2; line through (1,1),(3,3) -> FORECAST(4) = 4.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 1.0.into()),
                ("B2", "x".into()),
                ("B3", 3.0.into()),
            ],
            "=FORECAST(4,A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn error_member_propagates() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", Value::Error(CalcError::NA)),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            "=FORECAST(5,A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn extrapolation() {
        // ys {2,4,6} on xs {1,2,3}: FORECAST(-2) = -4.
        assert_eq!(n(&eval("=FORECAST(-2,{2,4,6},{1,2,3})")), -4.0);
    }

    #[test]
    fn matches_forecast_linear() {
        assert_eq!(
            n(&eval("=FORECAST(30,{6,7,9,15,21},{20,28,31,38,40})")),
            n(&eval("=FORECAST.LINEAR(30,{6,7,9,15,21},{20,28,31,38,40})"))
        );
    }
}
