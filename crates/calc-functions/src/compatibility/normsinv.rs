//! `NORMSINV(probability)` — legacy inverse of the standard normal
//! CDF. Spec: `docs/functions/NORMSINV.md`.
//!
//! Delegates to [`numerics::normal_inv`] (Acklam's rational
//! approximation + one Halley step, ~1e-15 absolute) — more accurate
//! than Excel's documented ~3e-7 iteration; `NORMSINV(0.5)` is
//! exactly `0`. Both deltas vs Excel are spec open questions.

use crate::common::{numerics, statistics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match statistics::scalar_number(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(p) if p <= 0.0 || p >= 1.0 => Ok(Value::Error(CalcError::Num)),
        Ok(p) => Ok(Value::Number(numerics::normal_inv(p))),
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
    fn doc_example() {
        // Excel doc: NORMSINV(0.908789) = 1.3333347.
        let v = n(&eval("=NORMSINV(0.908789)"));
        assert!((v - 1.3333347).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn median_is_zero() {
        assert_eq!(n(&eval("=NORMSINV(0.5)")), 0.0);
    }

    #[test]
    fn quantile_975() {
        let v = n(&eval("=NORMSINV(0.975)"));
        assert!((v - 1.9599640).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn quantile_25_negative() {
        let v = n(&eval("=NORMSINV(0.025)"));
        assert!((v + 1.9599640).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn round_trip() {
        let z = n(&eval("=NORMSINV(0.99)"));
        let p = n(&eval(&format!("=NORMSDIST({z})")));
        assert!((p - 0.99).abs() < 1e-12);
    }

    #[test]
    fn matches_norm_s_inv() {
        assert_eq!(n(&eval("=NORMSINV(0.9)")), n(&eval("=NORM.S.INV(0.9)")));
    }

    #[test]
    fn boundary_num() {
        assert_eq!(e(&eval("=NORMSINV(0)")), CalcError::Num);
        assert_eq!(e(&eval("=NORMSINV(1)")), CalcError::Num);
    }

    #[test]
    fn out_of_range_num() {
        assert_eq!(e(&eval("=NORMSINV(-0.5)")), CalcError::Num);
        assert_eq!(e(&eval("=NORMSINV(1.5)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=NORMSINV(\"abc\")")), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        let v = n(&eval("=NORMSINV(\"0.975\")"));
        assert!((v - 1.9599640).abs() < 1e-6);
    }

    #[test]
    fn boolean_coerces() {
        // FALSE -> 0 -> #NUM! boundary; TRUE -> 1 -> #NUM!.
        assert_eq!(e(&eval("=NORMSINV(FALSE)")), CalcError::Num);
        assert_eq!(e(&eval("=NORMSINV(TRUE)")), CalcError::Num);
    }

    #[test]
    fn bad_arity() {
        assert!(matches!(eval("=NORMSINV()"), Value::Error(_)));
        assert!(matches!(eval("=NORMSINV(0.5,0.6)"), Value::Error(_)));
    }
}
