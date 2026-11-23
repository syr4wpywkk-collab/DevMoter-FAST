//! `VAR(number1, [number2], ...)` — legacy sample variance
//! (denominator n-1). Spec: `docs/functions/VAR.md`.
//!
//! Identical semantics and coercion split to `VAR.S` (the
//! SUM-family rule). `n < 2` numeric values -> `#DIV/0!`.

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
        Some(v) => Ok(Value::Number(v)),
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
        // Excel doc: VAR(1345,...) = 754.2666667.
        let v = n(&eval(
            "=VAR(1345,1301,1368,1322,1310,1370,1318,1350,1303,1299)",
        ));
        assert!((v - 754.2666667).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn basic() {
        assert_eq!(n(&eval("=VAR(1,2,3)")), 1.0);
    }

    #[test]
    fn two_values() {
        assert_eq!(n(&eval("=VAR(1,3)")), 2.0);
    }

    #[test]
    fn single_value_div_zero() {
        assert_eq!(e(&eval("=VAR(5)")), CalcError::DivZero);
    }

    #[test]
    fn matches_var_s() {
        assert_eq!(
            n(&eval("=VAR(2,4,4,4,5,5,7,9)")),
            n(&eval("=VAR.S(2,4,4,4,5,5,7,9)"))
        );
    }

    #[test]
    fn equals_stdev_squared() {
        let v = n(&eval("=VAR(1,2,3,4,5)"));
        let s = n(&eval("=STDEV(1,2,3,4,5)"));
        assert!((v - s * s).abs() < 1e-12);
    }

    #[test]
    fn bool_and_text_scalars_coerce() {
        // {1,4}: sample var = 4.5
        assert_eq!(n(&eval("=VAR(TRUE,\"4\")")), 4.5);
    }

    #[test]
    fn non_numeric_text_value() {
        assert_eq!(e(&eval("=VAR(\"x\",1,2)")), CalcError::Value);
    }

    #[test]
    fn range_ignores_text_and_booleans() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", Value::Number(1.0)),
                ("A3", Value::Number(3.0)),
            ],
            "=VAR(A1:A3)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Num))], "=VAR(A1:A2,1,2)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn all_equal_values_zero() {
        assert_eq!(n(&eval("=VAR(7,7,7)")), 0.0);
    }

    #[test]
    fn empty_numeric_set_div_zero() {
        let v = eval_with(&[("A1", Value::Text("x".into()))], "=VAR(A1:A3)");
        assert_eq!(e(&v), CalcError::DivZero);
    }
}
