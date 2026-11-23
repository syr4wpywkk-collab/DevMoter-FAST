//! `FORECAST.LINEAR(x, known_ys, known_xs)` — the Excel-2016+ name for
//! `FORECAST`; identical least-squares semantics. Spec:
//! `docs/functions/FORECAST.LINEAR.md`.
//!
//! Delegates to [`super::forecast::forecast_inner`].

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    super::forecast::forecast_inner(ctx, args)
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
            (n(&eval("=FORECAST.LINEAR(30,{6,7,9,15,21},{20,28,31,38,40})"))
                - 10.607_253_086_419_76)
                .abs()
                < 1e-12
        );
    }

    #[test]
    fn scaled_line() {
        assert_eq!(n(&eval("=FORECAST.LINEAR(10,{2,4,6},{1,2,3})")), 20.0);
    }

    #[test]
    fn perfect_line_origin() {
        assert_eq!(n(&eval("=FORECAST.LINEAR(0,{1,2,3},{1,2,3})")), 0.0);
    }

    #[test]
    fn size_mismatch_na() {
        assert_eq!(e(&eval("=FORECAST.LINEAR(5,{1,2},{1})")), CalcError::NA);
    }

    #[test]
    fn zero_x_variance_div_zero() {
        assert_eq!(
            e(&eval("=FORECAST.LINEAR(5,{1,2,3},{7,7,7})")),
            CalcError::DivZero
        );
    }

    #[test]
    fn non_numeric_x_value() {
        assert_eq!(
            e(&eval("=FORECAST.LINEAR(\"x\",{1,2},{1,2})")),
            CalcError::Value
        );
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
            "=FORECAST.LINEAR(5,A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn ranges_form() {
        let v = eval_with(
            &[
                ("A1", 6.0.into()),
                ("A2", 7.0.into()),
                ("A3", 9.0.into()),
                ("A4", 15.0.into()),
                ("A5", 21.0.into()),
                ("B1", 20.0.into()),
                ("B2", 28.0.into()),
                ("B3", 31.0.into()),
                ("B4", 38.0.into()),
                ("B5", 40.0.into()),
            ],
            "=FORECAST.LINEAR(30,A1:A5,B1:B5)",
        );
        assert!((n(&v) - 10.607_253_086_419_76).abs() < 1e-12);
    }

    #[test]
    fn interpolation() {
        // FORECAST.LINEAR at a known x returns that x's fitted value.
        assert_eq!(n(&eval("=FORECAST.LINEAR(2,{2,4,6},{1,2,3})")), 4.0);
    }

    #[test]
    fn text_pair_dropped() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 1.0.into()),
                ("B2", "x".into()),
                ("B3", 3.0.into()),
            ],
            "=FORECAST.LINEAR(4,A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=FORECAST.LINEAR(5,{1,2})")), CalcError::Value);
    }
}
