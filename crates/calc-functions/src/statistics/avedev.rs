//! `AVEDEV(number1, [number2], ...)` — average of the absolute deviations
//! from the mean: `SUM(ABS(x - mean)) / n`. Spec:
//! `docs/functions/AVEDEV.md`.
//!
//! Same coercion contract as `AVERAGE`: range members contribute numbers
//! only; direct scalars coerce via `to_number`; errors propagate.

use crate::common::coercion;
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
    if nums.is_empty() {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let mean = nums.iter().sum::<f64>() / nums.len() as f64;
    let avedev = nums.iter().map(|x| (x - mean).abs()).sum::<f64>() / nums.len() as f64;
    Ok(Value::Number(avedev))
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
        // AVEDEV(4,5,6,7,5,4,3) = 1.0204081632653061
        let v = n(&eval("=AVEDEV(4,5,6,7,5,4,3)"));
        assert!((v - 1.0204081632653061).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn array_constant() {
        let v = n(&eval("=AVEDEV({1,2,3})"));
        assert!((v - 0.6666666666666666).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn range_input() {
        let v = eval_with(
            &[
                ("A1", 2.0.into()),
                ("A2", 4.0.into()),
                ("A3", 6.0.into()),
                ("A4", 8.0.into()),
                ("A5", 10.0.into()),
            ],
            "=AVEDEV(A1:A5)",
        );
        assert_eq!(n(&v), 2.4);
    }

    #[test]
    fn single_value_zero() {
        assert_eq!(n(&eval("=AVEDEV(5)")), 0.0);
    }

    #[test]
    fn equal_values_zero() {
        assert_eq!(n(&eval("=AVEDEV(3,3,3,3)")), 0.0);
    }

    #[test]
    fn negative_values() {
        // {-2, 2}: mean 0, avedev 2.
        assert_eq!(n(&eval("=AVEDEV(-2,2)")), 2.0);
    }

    #[test]
    fn range_ignores_text_bool_blank() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "x".into()),
                ("A3", Value::Boolean(true)),
                ("A4", 3.0.into()),
            ],
            "=AVEDEV(A1:A5)",
        );
        // {1, 3}: mean 2, avedev 1.
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=AVEDEV("1",3)"#)), 1.0);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=AVEDEV("text",A1:A2)"#)), CalcError::Value);
    }

    #[test]
    fn direct_boolean_coerces() {
        // {1, 0}: mean 0.5, avedev 0.5.
        assert_eq!(n(&eval("=AVEDEV(TRUE,FALSE)")), 0.5);
    }

    #[test]
    fn all_blank_range_div_zero() {
        assert_eq!(e(&eval("=AVEDEV(A1:A3)")), CalcError::DivZero);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::Ref)), ("A2", 1.0.into())],
            "=AVEDEV(A1:A3)",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }
}
