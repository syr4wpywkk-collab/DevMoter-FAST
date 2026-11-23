//! `SUM(number1, [number2], ...)` — adds all numeric arguments.
//! Spec: `docs/functions/SUM.md`.

use crate::ast::Expr;
use crate::eval::{EvalContext, EvalError};
use crate::functions::{MAX_ARGS, check_arity, helpers};
use crate::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    match helpers::collect_numbers(ctx, args)? {
        Err(e) => Ok(Value::Error(e)),
        Ok(nums) => Ok(Value::Number(nums.iter().sum())),
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
        assert_eq!(n(&eval("=SUM(1,2,3)")), 6.0);
    }

    #[test]
    fn range_of_numbers() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=SUM(A1:A3)",
        );
        assert_eq!(n(&v), 6.0);
    }

    #[test]
    fn range_ignores_text() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", "x".into()), ("A3", 3.0.into())],
            "=SUM(A1:A3)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn range_ignores_blank() {
        let v = eval_with(&[("A1", 1.0.into()), ("A3", 3.0.into())], "=SUM(A1:A3)");
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn range_ignores_booleans() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", 2.0.into()),
                ("A3", Value::Boolean(false)),
            ],
            "=SUM(A1:A3)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn single_ref_ignores_text() {
        // A text cell via single ref follows range rules (Excel: =SUM(A1) -> 0).
        let v = eval_with(&[("A1", "3".into())], "=SUM(A1)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn no_numbers_gives_zero() {
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=SUM(A1:A3)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=SUM("3",2)"#)), 5.0);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=SUM("abc")"#)), CalcError::Value);
    }

    #[test]
    fn direct_boolean_coerces() {
        assert_eq!(n(&eval("=SUM(TRUE,2)")), 3.0);
    }

    #[test]
    fn mixed_ranges_and_scalars() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", 10.0.into()),
                ("B2", 20.0.into()),
            ],
            "=SUM(A1:A2,B1:B2)",
        );
        assert_eq!(n(&v), 33.0);
    }

    #[test]
    fn negatives_and_fractions() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 0.5.into()),
                ("A3", (-2.0).into()),
            ],
            "=SUM(A1:A3)",
        );
        assert_eq!(n(&v), -0.5);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=SUM(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn error_in_argument_propagates() {
        assert_eq!(e(&eval("=SUM(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn two_d_range() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("B1", 2.0.into()),
                ("A2", 3.0.into()),
                ("B2", 4.0.into()),
            ],
            "=SUM(A1:B2)",
        );
        assert_eq!(n(&v), 10.0);
    }

    #[test]
    fn arity_zero_errors() {
        assert_eq!(e(&eval("=SUM()")), CalcError::Value);
    }
}
