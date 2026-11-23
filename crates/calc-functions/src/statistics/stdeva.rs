//! `STDEVA(value1, [value2], ...)` — sample standard deviation with
//! `A`-family coercion. Spec: `docs/functions/STDEVA.md`.

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
    fn basic_sample_sd() {
        assert_eq!(n(&eval("=STDEVA(1,2,3)")), 1.0);
    }

    #[test]
    fn range_coerces_bool_text_blank() {
        // {TRUE,"x",blank} -> {1,0,0} -> sd sqrt(1/3).
        let v = eval_with(
            &[("A1", Value::Boolean(true)), ("A2", "x".into())],
            "=STDEVA(A1:A3)",
        );
        assert!((n(&v) - (1.0f64 / 3.0).sqrt()).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn single_value_div_zero() {
        assert_eq!(e(&eval("=STDEVA(10)")), CalcError::DivZero);
    }

    #[test]
    fn single_cell_div_zero() {
        // Blank counts as a value -> n = 1 -> #DIV/0!.
        let v = eval_with(&[("A1", "x".into())], "=STDEVA(A1:A1)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn all_equal_gives_zero() {
        assert_eq!(n(&eval("=STDEVA(5,5,5)")), 0.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        // "1" -> 1, so {1,3}: sample sd sqrt(2).
        assert_eq!(n(&eval(r#"=STDEVA("1",3)"#)), std::f64::consts::SQRT_2);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=STDEVA("abc",3)"#)), CalcError::Value);
    }

    #[test]
    fn direct_boolean_coerces() {
        assert_eq!(n(&eval("=STDEVA(TRUE,3)")), std::f64::consts::SQRT_2);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=STDEVA(A1:A3)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn error_in_argument_propagates() {
        assert_eq!(e(&eval("=STDEVA(1/0,2)")), CalcError::DivZero);
    }

    #[test]
    fn differs_from_stdev_s_on_text_range() {
        // STDEV.S ignores text -> n=1 -> error; STDEVA counts it as 0.
        let cells = [("A1", 1.0.into()), ("A2", "x".into())];
        assert_eq!(e(&eval_with(&cells, "=STDEV.S(A1:A2)")), CalcError::DivZero);
        let v = eval_with(&cells, "=STDEVA(A1:A2)");
        // {1,0}: var = 0.5 -> sd sqrt(0.5).
        assert!((n(&v) - 0.5f64.sqrt()).abs() < 1e-12, "got {v}");
    }
}
