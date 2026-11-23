//! `NORMSDIST(z)` — legacy standard normal CDF `P(Z <= z)`.
//! Spec: `docs/functions/NORMSDIST.md`.
//!
//! Always the cumulative (the PDF variant is `NORM.S.DIST`'s modern
//! `cumulative` flag). Delegates to [`numerics::normal_cdf`]
//! (`erf`-based, ~1e-15) — more accurate than Excel's approximation;
//! the deviation is a recorded spec open question.

use crate::common::{numerics, statistics};
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match statistics::scalar_number(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(z) => Ok(Value::Number(numerics::normal_cdf(z))),
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
        // Excel doc: NORMSDIST(1.333333) = 0.908789.
        assert!((n(&eval("=NORMSDIST(1.333333)")) - 0.908789).abs() < 1e-5);
    }

    #[test]
    fn zero_is_half() {
        assert_eq!(n(&eval("=NORMSDIST(0)")), 0.5);
    }

    #[test]
    fn negative_z() {
        assert!((n(&eval("=NORMSDIST(-1.96)")) - 0.0249979).abs() < 1e-6);
    }

    #[test]
    fn symmetry() {
        let a = n(&eval("=NORMSDIST(1.234)"));
        let b = n(&eval("=NORMSDIST(-1.234)"));
        assert!((a + b - 1.0).abs() < 1e-15);
    }

    #[test]
    fn matches_norm_s_dist() {
        assert_eq!(
            n(&eval("=NORMSDIST(0.7)")),
            n(&eval("=NORM.S.DIST(0.7,TRUE)"))
        );
    }

    #[test]
    fn saturates_in_tails() {
        assert_eq!(n(&eval("=NORMSDIST(50)")), 1.0);
        assert_eq!(n(&eval("=NORMSDIST(-50)")), 0.0);
    }

    #[test]
    fn round_trip_normsinv() {
        let p = n(&eval("=NORMSDIST(1.5)"));
        let z = n(&eval(&format!("=NORMSINV({p})")));
        assert!((z - 1.5).abs() < 1e-12);
    }

    #[test]
    fn non_numeric_value() {
        assert_eq!(e(&eval("=NORMSDIST(\"abc\")")), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert!((n(&eval("=NORMSDIST(\"1.96\")")) - 0.9750021).abs() < 1e-6);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=NORMSDIST(TRUE)")), n(&eval("=NORMSDIST(1)")));
    }

    #[test]
    fn bad_arity() {
        assert!(matches!(eval("=NORMSDIST(1,2)"), Value::Error(_)));
        assert!(matches!(eval("=NORMSDIST()"), Value::Error(_)));
    }
}
