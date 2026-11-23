//! `AVERAGE(number1, [number2], ...)` — arithmetic mean of numeric
//! arguments. Spec: `docs/functions/AVERAGE.md`.

use crate::ast::Expr;
use crate::error::CalcError;
use crate::eval::{EvalContext, EvalError};
use crate::functions::{MAX_ARGS, check_arity, helpers};
use crate::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    match helpers::collect_numbers(ctx, args)? {
        Err(e) => Ok(Value::Error(e)),
        Ok(nums) if nums.is_empty() => Ok(Value::Error(CalcError::DivZero)),
        Ok(nums) => Ok(Value::Number(nums.iter().sum::<f64>() / nums.len() as f64)),
    }
}

#[cfg(test)]
mod tests {
    use super::super::helpers::test_support::*;
    use crate::{CalcError, Value};

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
    fn direct_numbers() {
        assert_eq!(n(&eval("=AVERAGE(1,2,3)")), 2.0);
    }

    #[test]
    fn range_of_numbers() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=AVERAGE(A1:A3)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn no_numerics_div_zero() {
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=AVERAGE(A1:A3)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn ignores_text_and_blank() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", "x".into()), ("A3", 3.0.into())],
            "=AVERAGE(A1:A4)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=AVERAGE("4",6)"#)), 5.0);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=AVERAGE(0)")), 0.0);
    }

    #[test]
    fn symmetric_negatives() {
        assert_eq!(n(&eval("=AVERAGE(-1,1)")), 0.0);
    }

    #[test]
    fn float_result() {
        assert!((n(&eval("=AVERAGE(0.1,0.2)")) - 0.15).abs() < 1e-15);
    }

    #[test]
    fn direct_boolean_coerces() {
        assert_eq!(n(&eval("=AVERAGE(TRUE,3)")), 2.0);
    }

    #[test]
    fn range_ignores_booleans() {
        let v = eval_with(
            &[("A1", Value::Boolean(true)), ("A2", 4.0.into())],
            "=AVERAGE(A1:A3)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn mixed_range_and_cell_ref() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", 4.0.into()), ("B1", 6.0.into())],
            "=AVERAGE(A1:A2,B1)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=AVERAGE(1/0)")), CalcError::DivZero);
    }
}
