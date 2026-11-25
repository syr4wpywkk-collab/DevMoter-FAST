//! `LARGE(array, k)` — the k-th largest numeric value in `array`.
//! Spec: `docs/functions/LARGE.md`.
//!
//! `k` is 1-based from the maximum, truncated to an integer per the
//! spec; `k` outside `1..=n` or an empty numeric set is `#NUM!`.

use crate::common::coercion;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let mut nums = match coercion::collect_numbers(ctx, &args[..1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    let k = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(k) => k.trunc(),
    };
    nums.sort_by(f64::total_cmp);
    let n = nums.len() as f64;
    if k < 1.0 || k > n {
        return Ok(Value::Error(CalcError::Num));
    }
    // k-th largest = index n - k in ascending order.
    Ok(Value::Number(nums[(n - k) as usize]))
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
    fn first_largest_is_max() {
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 5.0.into()),
                ("A3", 1.0.into()),
                ("A4", 4.0.into()),
            ],
            "=LARGE(A1:A4,1)",
        );
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn kth_largest() {
        let v = eval_with(
            &[
                ("B1", 3.0.into()),
                ("B2", 5.0.into()),
                ("B3", 1.0.into()),
                ("B4", 4.0.into()),
            ],
            "=LARGE(B1:B4,3)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn k_equals_count_returns_min() {
        let v = eval_with(
            &[("A1", 3.0.into()), ("A2", 5.0.into()), ("A3", 1.0.into())],
            "=LARGE(A1:A3,3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn duplicates_count() {
        let v = eval_with(
            &[("A1", 5.0.into()), ("A2", 5.0.into()), ("A3", 3.0.into())],
            "=LARGE(A1:A3,2)",
        );
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn k_zero_num_error() {
        let v = eval_with(&[("A1", 1.0.into())], "=LARGE(A1:A1,0)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn k_too_large_num_error() {
        let v = eval_with(&[("A1", 1.0.into()), ("A2", 2.0.into())], "=LARGE(A1:A2,3)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn empty_numeric_set_num_error() {
        let v = eval_with(&[("A1", "x".into())], "=LARGE(A1:A1,1)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn non_integer_k_truncated() {
        // LARGE({1,2,3}, 1.9) behaves as k=1 -> 3 (see spec open question).
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=LARGE(A1:A3,1.9)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn range_ignores_text_bool_blank() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "9".into()),
                ("A3", Value::Boolean(true)),
                ("A4", 4.0.into()),
            ],
            "=LARGE(A1:A5,2)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=LARGE(A1:A2,1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn k_from_cell_coerces() {
        let v = eval_with(
            &[("A1", 3.0.into()), ("A2", 5.0.into()), ("B1", 2.0.into())],
            "=LARGE(A1:A2,B1)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn negatives() {
        let v = eval_with(
            &[
                ("A1", (-1.0).into()),
                ("A2", (-5.0).into()),
                ("A3", 0.0.into()),
            ],
            "=LARGE(A1:A3,3)",
        );
        assert_eq!(n(&v), -5.0);
    }
}
