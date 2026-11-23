//! `PERCENTRANK(array, x, [significance])` — legacy percent rank of
//! `x` within `array` as a fraction in `[0,1]`.
//! Spec: `docs/functions/PERCENTRANK.md`.
//!
//! Identical to `PERCENTRANK.INC`: `x` matching an element ranks at
//! the first matching index (duplicate convention is spec-open);
//! between two elements interpolates linearly; outside `[min, max]`
//! is `#N/A`. The result is truncated to `significance` fractional
//! digits (default 3) per Excel's documented truncation — whether
//! Excel truncates or rounds is itself recorded open in the spec.

use crate::common::coercion;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Fractional 0-based rank of `x` within an ascending-sorted slice:
/// the first matching index on a hit, otherwise the interpolated
/// position between the bracketing values. `None` outside `[min, max]`.
fn interpolated_rank(sorted: &[f64], x: f64) -> Option<f64> {
    let n = sorted.len();
    if n == 0 || x < sorted[0] || x > sorted[n - 1] {
        return None;
    }
    let i = sorted.iter().position(|&v| v >= x).unwrap_or(n - 1);
    if sorted[i] == x {
        return Some(i as f64);
    }
    let (lo, hi) = (sorted[i - 1], sorted[i]);
    Some((i - 1) as f64 + (x - lo) / (hi - lo))
}

/// Truncate `v` to `digits` fractional decimal digits (toward zero).
fn trunc_digits(v: f64, digits: u32) -> f64 {
    let scale = 10f64.powi(digits as i32);
    (v * scale).trunc() / scale
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let mut nums = match coercion::collect_numbers(ctx, &args[..1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    let x = match statistics::scalar_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(x) => x,
    };
    let sig = match args.get(2) {
        None => 3,
        Some(a) => match statistics::scalar_number(ctx, a)? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(s) if s < 1.0 => return Ok(Value::Error(CalcError::Num)),
            Ok(s) => s.trunc().min(15.0) as u32,
        },
    };
    if nums.is_empty() {
        return Ok(Value::Error(CalcError::NA));
    }
    nums.sort_by(f64::total_cmp);
    let Some(rank) = interpolated_rank(&nums, x) else {
        return Ok(Value::Error(CalcError::NA));
    };
    // n == 1 reaches here only when x == the sole element (rank 0).
    let pct = if nums.len() == 1 {
        0.0
    } else {
        rank / (nums.len() - 1) as f64
    };
    Ok(Value::Number(trunc_digits(pct, sig)))
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
    fn doc_example() {
        // Excel doc: 3 below, 6 above -> 3/9 -> 0.333.
        let v = n(&eval("=PERCENTRANK({13,12,11,8,4,3,2,1,1,1},2,3)"));
        assert!((v - 0.333).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn interpolated_midpoint() {
        assert_eq!(n(&eval("=PERCENTRANK({1,2,3,4},2.5)")), 0.5);
    }

    #[test]
    fn exact_min_and_max() {
        assert_eq!(n(&eval("=PERCENTRANK({1,2,3,4},1)")), 0.0);
        assert_eq!(n(&eval("=PERCENTRANK({1,2,3,4},4)")), 1.0);
    }

    #[test]
    fn matches_percentrank_inc() {
        assert_eq!(
            n(&eval("=PERCENTRANK({1,2,3,4,5},3.5,2)")),
            n(&eval("=PERCENTRANK.INC({1,2,3,4,5},3.5,2)"))
        );
    }

    #[test]
    fn outside_range_na() {
        assert_eq!(e(&eval("=PERCENTRANK({1,2,3,4},5)")), CalcError::NA);
        assert_eq!(e(&eval("=PERCENTRANK({1,2,3,4},0)")), CalcError::NA);
    }

    #[test]
    fn empty_array_na() {
        let v = eval_with(&[("A1", Value::Text("x".into()))], "=PERCENTRANK(A1:A3,1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn significance_zero_num() {
        assert_eq!(e(&eval("=PERCENTRANK({1,2,3,4},2,0)")), CalcError::Num);
    }

    #[test]
    fn significance_truncates_result() {
        // x=4 sits at sorted index 5 -> 5/9 = 0.555... -> sig 2 -> 0.55
        let v = n(&eval("=PERCENTRANK({13,12,11,8,4,3,2,1,1,1},4,2)"));
        assert!((v - 0.55).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn default_significance_three() {
        // rank 1 of {1,2,3,4}: 1/3 = 0.333...
        assert_eq!(n(&eval("=PERCENTRANK({1,2,3,4},2)")), 0.333);
    }

    #[test]
    fn non_numeric_x_value() {
        assert_eq!(e(&eval("=PERCENTRANK({1,2,3},\"x\")")), CalcError::Value);
    }

    #[test]
    fn range_ignores_text() {
        let v = eval_with(
            &[
                ("A1", Value::Number(1.0)),
                ("A2", Value::Text("x".into())),
                ("A3", Value::Number(3.0)),
            ],
            "=PERCENTRANK(A1:A3,3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn duplicate_uses_first_index() {
        // x = 1 appears at indices 0,1,2 in sorted {1,1,1,2}: rank 0.
        assert_eq!(n(&eval("=PERCENTRANK({2,1,1,1},1)")), 0.0);
    }
}
