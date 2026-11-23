//! `VARPA(value1, [value2], ...)` — population variance with
//! `A`-family coercion. Spec: `docs/functions/VARPA.md`.

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
    match statistics::population_variance(&nums) {
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
    fn basic_population_variance() {
        // VARPA(1,2,3) = 2/3.
        let v = n(&eval("=VARPA(1,2,3)"));
        assert!((v - 2.0 / 3.0).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn range_coerces_bool_and_blank() {
        // {TRUE, blank} -> {1, 0} -> var 0.25.
        let v = eval_with(&[("A1", Value::Boolean(true))], "=VARPA(A1:A2)");
        assert_eq!(n(&v), 0.25);
    }

    #[test]
    fn single_value_gives_zero() {
        assert_eq!(n(&eval("=VARPA(10)")), 0.0);
    }

    #[test]
    fn all_equal_gives_zero() {
        assert_eq!(n(&eval("=VARPA(5,5,5)")), 0.0);
    }

    #[test]
    fn all_text_range_gives_zero() {
        // All cells coerce to 0 -> variance 0.
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=VARPA(A1:A3)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=VARPA("1",3)"#)), 1.0);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=VARPA("abc",3)"#)), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero)), ("A2", 1.0.into())],
            "=VARPA(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn error_in_argument_propagates() {
        assert_eq!(e(&eval("=VARPA(1/0,2)")), CalcError::DivZero);
    }

    #[test]
    fn mixed_scalar_and_range() {
        // Range {TRUE,"x"} -> {1,0}; plus scalar 3 -> {1,0,3} mean 4/3
        // var = ((1-4/3)^2+(0-4/3)^2+(3-4/3)^2)/3 = (1/9+16/9+25/9)/3 = 14/9.
        let v = eval_with(
            &[("A1", Value::Boolean(true)), ("A2", "x".into())],
            "=VARPA(A1:A2,3)",
        );
        assert!((n(&v) - 14.0 / 9.0).abs() < 1e-12, "got {v}");
    }
}
