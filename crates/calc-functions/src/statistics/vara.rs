//! `VARA(value1, [value2], ...)` — sample variance with `A`-family
//! coercion: in ranges `TRUE` = 1 and `FALSE`/text/blank = 0. Spec:
//! `docs/functions/VARA.md`.

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
    let nums = match statistics::collect_numbers_a(ctx, args)? {
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
    fn basic_sample_variance() {
        assert_eq!(n(&eval("=VARA(1,2,3)")), 1.0);
    }

    #[test]
    fn range_coerces_bool_text_blank() {
        // A1=TRUE, A2="x", A3=blank -> values {1,0,0}; sample var = 1/3.
        let v = eval_with(
            &[("A1", Value::Boolean(true)), ("A2", "x".into())],
            "=VARA(A1:A3)",
        );
        assert!((n(&v) - 1.0 / 3.0).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn range_false_and_text_zero() {
        // {FALSE, "x"} -> {0, 0} -> var 0.
        let v = eval_with(
            &[("A1", Value::Boolean(false)), ("A2", "x".into())],
            "=VARA(A1:A2)",
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn single_value_div_zero() {
        assert_eq!(e(&eval("=VARA(5)")), CalcError::DivZero);
    }

    #[test]
    fn single_cell_div_zero() {
        // One cell still yields n = 1 (blank counts as a 0 value).
        let v = eval_with(&[("A1", "x".into())], "=VARA(A1:A1)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn all_equal_gives_zero() {
        assert_eq!(n(&eval("=VARA(5,5,5)")), 0.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        // "1" -> 1, so {1,3}: sample var = 2.
        assert_eq!(n(&eval(r#"=VARA("1",3)"#)), 2.0);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=VARA("abc",3)"#)), CalcError::Value);
    }

    #[test]
    fn direct_boolean_coerces() {
        // {1, 3} -> var 2.
        assert_eq!(n(&eval("=VARA(TRUE,3)")), 2.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=VARA(A1:A3)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn error_in_argument_propagates() {
        assert_eq!(e(&eval("=VARA(1/0,2)")), CalcError::DivZero);
    }
}
