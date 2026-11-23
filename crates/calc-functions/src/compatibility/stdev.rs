//! `STDEV(number1, [number2], ...)` — legacy sample standard
//! deviation (denominator n-1). Spec: `docs/functions/STDEV.md`.
//!
//! Identical semantics and coercion split to `STDEV.S`: range
//! members contribute numbers only; direct scalars coerce text and
//! booleans (non-numeric text -> `#VALUE!`). `n < 2` numeric values
//! -> `#DIV/0!`.

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
    match statistics::sample_variance(&nums) {
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
        // Excel doc: STDEV(1345,...) = 27.46391572.
        let v = n(&eval(
            "=STDEV(1345,1301,1368,1322,1310,1370,1318,1350,1303,1299)",
        ));
        assert!((v - 27.46391572).abs() < 1e-7, "got {v}");
    }

    #[test]
    fn basic() {
        assert_eq!(n(&eval("=STDEV(1,2,3)")), 1.0);
    }

    #[test]
    fn two_values() {
        assert_eq!(n(&eval("=STDEV(1,3)")), std::f64::consts::SQRT_2);
    }

    #[test]
    fn single_value_div_zero() {
        assert_eq!(e(&eval("=STDEV(5)")), CalcError::DivZero);
    }

    #[test]
    fn matches_stdev_s() {
        assert_eq!(
            n(&eval("=STDEV(2,4,4,4,5,5,7,9)")),
            n(&eval("=STDEV.S(2,4,4,4,5,5,7,9)"))
        );
    }

    #[test]
    fn bool_and_text_scalars_coerce() {
        // TRUE -> 1, "4" -> 4: sd of {1,4} = sqrt(4.5)
        let v = n(&eval("=STDEV(TRUE,\"4\")"));
        assert!((v - 4.5f64.sqrt()).abs() < 1e-12);
    }

    #[test]
    fn non_numeric_text_value() {
        assert_eq!(e(&eval("=STDEV(\"abc\")")), CalcError::Value);
    }

    #[test]
    fn range_ignores_text_and_blanks() {
        let v = eval_with(
            &[
                ("A1", Value::Number(1.0)),
                ("A2", Value::Text("x".into())),
                ("A3", Value::Number(3.0)),
            ],
            "=STDEV(A1:A3)",
        );
        assert_eq!(n(&v), std::f64::consts::SQRT_2);
    }

    #[test]
    fn range_booleans_ignored() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", Value::Number(1.0)),
                ("A3", Value::Number(3.0)),
            ],
            "=STDEV(A1:A3)",
        );
        assert_eq!(n(&v), std::f64::consts::SQRT_2);
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Num))], "=STDEV(A1:A2,1,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn all_equal_values_zero() {
        assert_eq!(n(&eval("=STDEV(7,7,7)")), 0.0);
    }

    #[test]
    fn mixed_scalar_and_range() {
        let v = eval_with(
            &[("A1", Value::Number(2.0)), ("A2", Value::Number(3.0))],
            "=STDEV(1,A1:A2)",
        );
        assert_eq!(n(&v), 1.0);
    }
}
