//! `STDEVP(number1, [number2], ...)` — legacy population standard
//! deviation (denominator n). Spec: `docs/functions/STDEVP.md`.
//!
//! Identical semantics and coercion split to `STDEV.P` (the
//! SUM-family rule). `n = 0` numeric values -> `#DIV/0!`; `n = 1`
//! returns `0`.

use crate::common::coercion;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let nums = match coercion::collect_numbers(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    match statistics::population_variance(&nums) {
        Some(v) => Ok(Value::Number(v.sqrt())),
        None => Ok(Value::Error(CalcError::DivZero)),
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
        // Excel doc: STDEVP(1345,...) = 26.05455814.
        let v = n(&eval(
            "=STDEVP(1345,1301,1368,1322,1310,1370,1318,1350,1303,1299)",
        ));
        assert!((v - 26.05455814).abs() < 1e-7, "got {v}");
    }

    #[test]
    fn basic() {
        // sqrt(2/3)
        assert!((n(&eval("=STDEVP(1,2,3)")) - 0.816496581).abs() < 1e-9);
    }

    #[test]
    fn single_value_zero() {
        assert_eq!(n(&eval("=STDEVP(5)")), 0.0);
    }

    #[test]
    fn empty_range_div_zero() {
        let v = eval_with(&[("A1", Value::Text("x".into()))], "=STDEVP(A1:A3)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn matches_stdev_p() {
        assert_eq!(
            n(&eval("=STDEVP(2,4,4,4,5,5,7,9)")),
            n(&eval("=STDEV.P(2,4,4,4,5,5,7,9)"))
        );
    }

    #[test]
    fn relation_to_stdev() {
        // STDEVP = STDEV * sqrt((n-1)/n)
        let p = n(&eval("=STDEVP(1,2,3,4,5)"));
        let s = n(&eval("=STDEV(1,2,3,4,5)"));
        assert!((p - s * (4.0f64 / 5.0).sqrt()).abs() < 1e-12);
    }

    #[test]
    fn bool_and_text_scalars_coerce() {
        // {1,4}: mean 2.5, pop sd = 1.5
        assert_eq!(n(&eval("=STDEVP(TRUE,\"4\")")), 1.5);
    }

    #[test]
    fn non_numeric_text_value() {
        assert_eq!(e(&eval("=STDEVP(\"abc\")")), CalcError::Value);
    }

    #[test]
    fn range_ignores_text_and_booleans() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", Value::Number(1.0)),
                ("A3", Value::Number(3.0)),
            ],
            "=STDEVP(A1:A3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Num))], "=STDEVP(A1:A2,1)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn all_equal_values_zero() {
        assert_eq!(n(&eval("=STDEVP(7,7,7)")), 0.0);
    }

    #[test]
    fn bad_arity() {
        assert!(matches!(eval("=STDEVP()"), Value::Error(_)));
    }
}
