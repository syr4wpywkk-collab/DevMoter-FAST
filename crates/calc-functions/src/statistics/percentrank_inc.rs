//! `PERCENTRANK.INC(array, x, [significance])` — rank of `x` as an
//! inclusive percentage `rank/(n-1)`. Spec: `docs/functions/PERCENTRANK.INC.md`.
//!
//! `x` matching an element ranks at the *first* matching index
//! (duplicate convention is SPEC-OPEN in the spec doc); `x` between two
//! distinct values interpolates linearly; `x` outside `[min, max]` is
//! `#N/A`. The result is truncated to `significance` digits (default
//! `3`), matching Excel's documented truncation.

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
pub(crate) fn interpolated_rank(sorted: &[f64], x: f64) -> Option<f64> {
    let n = sorted.len();
    if n == 0 || x < sorted[0] || x > sorted[n - 1] {
        return None;
    }
    // First index whose value is >= x.
    let i = sorted.iter().position(|&v| v >= x).unwrap_or(n - 1);
    if sorted[i] == x {
        return Some(i as f64);
    }
    // sorted[i-1] < x < sorted[i].
    let (lo, hi) = (sorted[i - 1], sorted[i]);
    Some((i - 1) as f64 + (x - lo) / (hi - lo))
}

/// Parse the optional `significance` argument (`>= 1` integer digits,
/// truncated). Errors map to `Value::Error` at the call site.
pub(crate) fn significance(
    ctx: &mut EvalContext<'_>,
    arg: Option<&Expr>,
) -> Result<Result<u32, CalcError>, EvalError> {
    let Some(arg) = arg else { return Ok(Ok(3)) };
    match statistics::scalar_number(ctx, arg)? {
        Err(e) => Ok(Err(e)),
        Ok(s) if s < 1.0 => Ok(Err(CalcError::Num)),
        Ok(s) => Ok(Ok(s.trunc().min(15.0) as u32)),
    }
}

/// Truncate `v` to `digits` fractional decimal digits (toward zero).
pub(crate) fn trunc_digits(v: f64, digits: u32) -> f64 {
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
    let sig = match significance(ctx, args.get(2))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => s,
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

    fn cells5() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", 1.0.into()),
            ("A2", 2.0.into()),
            ("A3", 3.0.into()),
            ("A4", 4.0.into()),
            ("A5", 5.0.into()),
        ]
    }

    #[test]
    fn doc_example() {
        // Excel doc: {13,12,11,8,4,3,2,1,1,1}, x=2 -> 0.333.
        let v = eval_with(
            &[
                ("A1", 13.0.into()),
                ("A2", 12.0.into()),
                ("A3", 11.0.into()),
                ("A4", 8.0.into()),
                ("A5", 4.0.into()),
                ("A6", 3.0.into()),
                ("A7", 2.0.into()),
                ("A8", 1.0.into()),
                ("A9", 1.0.into()),
                ("A10", 1.0.into()),
            ],
            "=PERCENTRANK.INC(A1:A10,2)",
        );
        assert!((n(&v) - 0.333).abs() < 1e-9);
    }

    #[test]
    fn midpoint_exact() {
        assert_eq!(n(&eval_with(&cells5(), "=PERCENTRANK.INC(A1:A5,3)")), 0.5);
    }

    #[test]
    fn max_is_one() {
        assert_eq!(n(&eval_with(&cells5(), "=PERCENTRANK.INC(A1:A5,5)")), 1.0);
    }

    #[test]
    fn min_is_zero() {
        assert_eq!(n(&eval_with(&cells5(), "=PERCENTRANK.INC(A1:A5,1)")), 0.0);
    }

    #[test]
    fn above_max_na() {
        assert_eq!(
            e(&eval_with(&cells5(), "=PERCENTRANK.INC(A1:A5,6)")),
            CalcError::NA
        );
    }

    #[test]
    fn below_min_na() {
        assert_eq!(
            e(&eval_with(&cells5(), "=PERCENTRANK.INC(A1:A5,0)")),
            CalcError::NA
        );
    }

    #[test]
    fn interpolates() {
        // x=2.5 sits halfway between ranks 1 and 2 -> (1 + 0.5)/4 = 0.375.
        assert_eq!(
            n(&eval_with(&cells5(), "=PERCENTRANK.INC(A1:A5,2.5)")),
            0.375
        );
    }

    #[test]
    fn significance_truncates() {
        // rank of 1.5 between 1 and 2 -> (0 + 0.5)/4 = 0.125; sig=2 -> 0.12.
        assert_eq!(
            n(&eval_with(&cells5(), "=PERCENTRANK.INC(A1:A5,1.5,2)")),
            0.12
        );
    }

    #[test]
    fn significance_below_one_num() {
        assert_eq!(
            e(&eval_with(&cells5(), "=PERCENTRANK.INC(A1:A5,3,0)")),
            CalcError::Num
        );
    }

    #[test]
    fn single_element_equal() {
        let v = eval_with(&[("A1", 7.0.into())], "=PERCENTRANK.INC(A1:A1,7)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn empty_set_na() {
        let v = eval_with(&[("A1", "x".into())], "=PERCENTRANK.INC(A1:A1,1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn x_text_value_error() {
        assert_eq!(
            e(&eval_with(&cells5(), r#"=PERCENTRANK.INC(A1:A5,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero)), ("A2", 1.0.into())],
            "=PERCENTRANK.INC(A1:A2,1)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn duplicate_first_rank() {
        // {1,2,2,4}: first rank of 2 is index 1 -> 1/3.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 2.0.into()),
                ("A4", 4.0.into()),
            ],
            "=PERCENTRANK.INC(A1:A4,2)",
        );
        assert!((n(&v) - 0.333).abs() < 1e-9);
    }
}
