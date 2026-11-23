//! `PERCENTILE.INC(array, k)` — k-th inclusive percentile via linear
//! interpolation. Spec: `docs/functions/PERCENTILE.INC.md`.
//!
//! `k` is a fraction in `[0,1]`: `k=0` -> min, `k=1` -> max,
//! `k=0.5` -> median. `k` outside `[0,1]` or an empty numeric set is
//! `#NUM!`.

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
        Ok(k) => k,
    };
    if nums.is_empty() || !(0.0..=1.0).contains(&k) {
        return Ok(Value::Error(CalcError::Num));
    }
    nums.sort_by(f64::total_cmp);
    Ok(Value::Number(statistics::percentile_inc_sorted(&nums, k)))
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

    fn cells() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", 1.0.into()),
            ("A2", 2.0.into()),
            ("A3", 3.0.into()),
            ("A4", 4.0.into()),
        ]
    }

    #[test]
    fn k_zero_is_min() {
        assert_eq!(n(&eval_with(&cells(), "=PERCENTILE.INC(A1:A4,0)")), 1.0);
    }

    #[test]
    fn k_one_is_max() {
        assert_eq!(n(&eval_with(&cells(), "=PERCENTILE.INC(A1:A4,1)")), 4.0);
    }

    #[test]
    fn k_half_is_median() {
        assert_eq!(n(&eval_with(&cells(), "=PERCENTILE.INC(A1:A4,0.5)")), 2.5);
    }

    #[test]
    fn interpolates() {
        // {1,2,3,4}, k=0.75 -> rank 2.25 -> 3 + 0.25*(4-3) = 3.25
        assert_eq!(n(&eval_with(&cells(), "=PERCENTILE.INC(A1:A4,0.75)")), 3.25);
    }

    #[test]
    fn quartile_value() {
        assert_eq!(n(&eval_with(&cells(), "=PERCENTILE.INC(A1:A4,0.25)")), 1.75);
    }

    #[test]
    fn k_below_zero_num_error() {
        assert_eq!(
            e(&eval_with(&cells(), "=PERCENTILE.INC(A1:A4,-0.1)")),
            CalcError::Num
        );
    }

    #[test]
    fn k_above_one_num_error() {
        assert_eq!(
            e(&eval_with(&cells(), "=PERCENTILE.INC(A1:A4,1.01)")),
            CalcError::Num
        );
    }

    #[test]
    fn empty_numeric_set_num_error() {
        let v = eval_with(&[("A1", "x".into())], "=PERCENTILE.INC(A1:A1,0.5)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn k_text_value_error() {
        assert_eq!(
            e(&eval_with(&cells(), r#"=PERCENTILE.INC(A1:A4,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn single_value_any_k() {
        let v = eval_with(&[("A1", 7.0.into())], "=PERCENTILE.INC(A1:A1,0.3)");
        assert_eq!(n(&v), 7.0);
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
            "=PERCENTILE.INC(A1:A5,0.5)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=PERCENTILE.INC(A1:A2,0.5)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
