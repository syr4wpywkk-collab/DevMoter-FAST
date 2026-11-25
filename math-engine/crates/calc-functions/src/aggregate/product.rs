//! `PRODUCT(number1, [number2], ...)` — multiplies all numeric arguments.
//! Spec: `docs/functions/PRODUCT.md`.
//!
//! Coercion model is `SUM`'s (range members contribute only numbers,
//! scalars coerce via `Value::to_number`); an empty input set yields `1`
//! (the multiplicative identity — Excel's `PRODUCT()` over empties).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    match coercion::collect_numbers(ctx, args)? {
        Err(e) => Ok(Value::Error(e)),
        Ok(nums) => Ok(Value::Number(nums.iter().product())),
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
    fn direct_numbers() {
        assert_eq!(n(&eval("=PRODUCT(2,3,4)")), 24.0);
    }

    #[test]
    fn range_of_numbers() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", 3.0.into()), ("A3", 4.0.into())],
            "=PRODUCT(A1:A3)",
        );
        assert_eq!(n(&v), 24.0);
    }

    #[test]
    fn range_ignores_text_and_blank() {
        let v = eval_with(&[("A1", 2.0.into()), ("A2", "x".into())], "=PRODUCT(A1:A3)");
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn empty_inputs_give_one() {
        // Excel: PRODUCT over only-empty ranges is 1.
        let v = eval_with(&[("A1", "x".into())], "=PRODUCT(A1:A3)");
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn zero_in_range() {
        let v = eval_with(&[("A1", 0.0.into()), ("A2", 9.0.into())], "=PRODUCT(A1:A2)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=PRODUCT("3",2)"#)), 6.0);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=PRODUCT("abc")"#)), CalcError::Value);
    }

    #[test]
    fn direct_boolean_coerces() {
        assert_eq!(n(&eval("=PRODUCT(TRUE,5)")), 5.0);
        assert_eq!(n(&eval("=PRODUCT(FALSE,5)")), 0.0);
    }

    #[test]
    fn single_ref_ignores_text() {
        let v = eval_with(&[("A1", "3".into())], "=PRODUCT(A1)");
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn negatives() {
        assert_eq!(n(&eval("=PRODUCT(-2,3)")), -6.0);
        assert_eq!(n(&eval("=PRODUCT(-2,-3)")), 6.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 2.0.into())],
            "=PRODUCT(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn error_in_argument_propagates() {
        assert_eq!(e(&eval("=PRODUCT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn mixed_ranges_and_scalars() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", 3.0.into())],
            "=PRODUCT(A1:A2,4)",
        );
        assert_eq!(n(&v), 24.0);
    }

    #[test]
    fn arity_zero_errors() {
        assert_eq!(e(&eval("=PRODUCT()")), CalcError::Value);
    }
}
