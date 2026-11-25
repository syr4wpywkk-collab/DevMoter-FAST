//! `SMALL(array, k)` — the k-th smallest numeric value in `array`.
//! Spec: `docs/functions/SMALL.md`.
//!
//! Mirror of `LARGE`: `k` is 1-based from the minimum; `k` outside
//! `1..=n` or an empty numeric set is `#NUM!`.

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
    if k < 1.0 || k > nums.len() as f64 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(nums[k as usize - 1]))
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
    fn first_smallest_is_min() {
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 5.0.into()),
                ("A3", 1.0.into()),
                ("A4", 4.0.into()),
            ],
            "=SMALL(A1:A4,1)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn kth_smallest() {
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 5.0.into()),
                ("A3", 1.0.into()),
                ("A4", 4.0.into()),
            ],
            "=SMALL(A1:A4,3)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn k_equals_count_returns_max() {
        let v = eval_with(
            &[("A1", 3.0.into()), ("A2", 5.0.into()), ("A3", 1.0.into())],
            "=SMALL(A1:A3,3)",
        );
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn duplicates_count() {
        let v = eval_with(
            &[("A1", 5.0.into()), ("A2", 5.0.into()), ("A3", 3.0.into())],
            "=SMALL(A1:A3,2)",
        );
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn small_large_duality() {
        // SMALL(x,k) = LARGE(x,n-k+1) for n numeric values.
        let cells: &[(&str, Value)] = &[
            ("A1", 7.0.into()),
            ("A2", 2.0.into()),
            ("A3", 9.0.into()),
            ("A4", 4.0.into()),
        ];
        let s = eval_with(cells, "=SMALL(A1:A4,2)");
        let l = eval_with(cells, "=LARGE(A1:A4,3)");
        assert_eq!(n(&s), n(&l));
    }

    #[test]
    fn k_zero_num_error() {
        let v = eval_with(&[("A1", 1.0.into())], "=SMALL(A1:A1,0)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn k_too_large_num_error() {
        let v = eval_with(&[("A1", 1.0.into()), ("A2", 2.0.into())], "=SMALL(A1:A2,5)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn empty_numeric_set_num_error() {
        let v = eval_with(&[("A1", "x".into())], "=SMALL(A1:A1,1)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn non_integer_k_truncated() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=SMALL(A1:A3,2.9)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn range_ignores_text_bool_blank() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "0".into()),
                ("A3", Value::Boolean(false)),
                ("A4", 4.0.into()),
            ],
            "=SMALL(A1:A5,2)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=SMALL(A1:A2,1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn negatives() {
        let v = eval_with(
            &[
                ("A1", (-1.0).into()),
                ("A2", (-5.0).into()),
                ("A3", 0.0.into()),
            ],
            "=SMALL(A1:A3,1)",
        );
        assert_eq!(n(&v), -5.0);
    }
}
