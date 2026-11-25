//! `MEDIAN(number1, [number2], ...)` — middle value of the counted
//! numbers. Spec: `docs/functions/MEDIAN.md`.
//!
//! Even `n` uses `f64::midpoint` on the two central values so extreme
//! opposite-sign magnitudes cannot overflow (see `MEDIAN.md`).

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
    let mut nums = match coercion::collect_numbers(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    if nums.is_empty() {
        // Excel: no numeric inputs -> #NUM! (see spec open question).
        return Ok(Value::Error(CalcError::Num));
    }
    nums.sort_by(f64::total_cmp);
    Ok(Value::Number(statistics::sorted_median(&nums)))
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
    fn odd_count() {
        assert_eq!(n(&eval("=MEDIAN(1,3,2)")), 2.0);
    }

    #[test]
    fn even_count_averages_middle() {
        assert_eq!(n(&eval("=MEDIAN(1,2,3,10)")), 2.5);
    }

    #[test]
    fn single_value() {
        assert_eq!(n(&eval("=MEDIAN(7)")), 7.0);
    }

    #[test]
    fn duplicates() {
        assert_eq!(n(&eval("=MEDIAN(1,2,2,9)")), 2.0);
    }

    #[test]
    fn negatives() {
        assert_eq!(n(&eval("=MEDIAN(-5,3,0)")), 0.0);
    }

    #[test]
    fn no_numeric_values_num_error() {
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=MEDIAN(A1:A3)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn range_ignores_text_bool_blank() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "skip".into()),
                ("A3", Value::Boolean(false)),
                ("A4", 9.0.into()),
            ],
            "=MEDIAN(A1:A5)",
        );
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=MEDIAN("2",8)"#)), 5.0);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=MEDIAN("abc")"#)), CalcError::Value);
    }

    #[test]
    fn direct_boolean_coerces() {
        assert_eq!(n(&eval("=MEDIAN(TRUE,5)")), 3.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=MEDIAN(A1:A3)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn extreme_magnitudes_no_overflow() {
        // (a+b)/2 would overflow; midpoint gives 0.
        assert_eq!(n(&eval("=MEDIAN(-1E+308,1E+308)")), 0.0);
    }
}
