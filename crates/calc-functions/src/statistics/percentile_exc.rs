//! `PERCENTILE.EXC(array, k)` — k-th exclusive percentile via linear
//! interpolation with `0 < k < 1`. Spec: `docs/functions/PERCENTILE.EXC.md`.
//!
//! Rank `h = k*(n+1)` is 1-based: an integer `h` selects `x_(h)`,
//! otherwise the result interpolates between `x_(floor h)` and
//! `x_(ceil h)`. `h` outside `[1, n]` is `#NUM!` (the boundary `h = 1`
//! and `h = n` return the min/max — the spec doc's worked example has
//! `k = 1/(n+1)` -> min; Excel help text suggesting `k <= 1/(n+1)`
//! errors is recorded SPEC-OPEN).

use crate::common::coercion;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Exclusive percentile over an ascending-sorted, non-empty slice.
/// Caller guarantees `1 <= h <= n`.
fn percentile_exc_sorted(sorted: &[f64], h: f64) -> f64 {
    let n = sorted.len();
    let lo = (h.floor() as usize).max(1);
    if lo >= n {
        return sorted[n - 1];
    }
    let frac = h - lo as f64;
    sorted[lo - 1] + (sorted[lo] - sorted[lo - 1]) * frac
}

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
    if nums.is_empty() || !(0.0..1.0).contains(&k) {
        return Ok(Value::Error(CalcError::Num));
    }
    nums.sort_by(f64::total_cmp);
    let h = k * (nums.len() + 1) as f64;
    if !(1.0..=nums.len() as f64).contains(&h) {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(percentile_exc_sorted(&nums, h)))
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
    fn doc_example_median_odd() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("A4", 4.0.into()),
                ("A5", 5.0.into()),
            ],
            "=PERCENTILE.EXC(A1:A5,0.5)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn doc_example_even_interp() {
        assert_eq!(n(&eval_with(&cells(), "=PERCENTILE.EXC(A1:A4,0.5)")), 2.5);
    }

    #[test]
    fn doc_example_h_at_one() {
        // k = 1/(n+1) -> h = 1 -> min (spec-doc example).
        assert_eq!(n(&eval_with(&cells(), "=PERCENTILE.EXC(A1:A4,0.2)")), 1.0);
    }

    #[test]
    fn doc_example_out_of_range_num() {
        assert_eq!(
            e(&eval_with(&cells(), "=PERCENTILE.EXC(A1:A4,0.9)")),
            CalcError::Num
        );
    }

    #[test]
    fn h_at_n_is_max() {
        // k = n/(n+1) = 0.8 -> h = 4 -> max.
        assert_eq!(n(&eval_with(&cells(), "=PERCENTILE.EXC(A1:A4,0.8)")), 4.0);
    }

    #[test]
    fn interpolates() {
        // h = 0.3*5 = 1.5 -> x1 + 0.5*(x2-x1) = 1.5
        assert_eq!(n(&eval_with(&cells(), "=PERCENTILE.EXC(A1:A4,0.3)")), 1.5);
    }

    #[test]
    fn k_zero_num_error() {
        assert_eq!(
            e(&eval_with(&cells(), "=PERCENTILE.EXC(A1:A4,0)")),
            CalcError::Num
        );
    }

    #[test]
    fn k_one_num_error() {
        assert_eq!(
            e(&eval_with(&cells(), "=PERCENTILE.EXC(A1:A4,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn k_below_boundary_num() {
        // k = 0.19 < 0.2 -> h < 1.
        assert_eq!(
            e(&eval_with(&cells(), "=PERCENTILE.EXC(A1:A4,0.19)")),
            CalcError::Num
        );
    }

    #[test]
    fn empty_numeric_set_num_error() {
        let v = eval_with(&[("A1", "x".into())], "=PERCENTILE.EXC(A1:A1,0.5)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn k_text_value_error() {
        assert_eq!(
            e(&eval_with(&cells(), r#"=PERCENTILE.EXC(A1:A4,"x")"#)),
            CalcError::Value
        );
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
            "=PERCENTILE.EXC(A1:A5,0.5)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=PERCENTILE.EXC(A1:A2,0.5)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
