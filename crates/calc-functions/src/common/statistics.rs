//! Statistics kernels (v2 §3): shared numeric kernels for the
//! statistics category — sample variance (`STDEV.S`/`VAR.S`), order
//! statistics (`MEDIAN`, `LARGE`/`SMALL`, `PERCENTILE.INC`/
//! `QUARTILE.INC` interpolation), and paired-sample reduction
//! (`CORREL`/`SLOPE`/`INTERCEPT`) with the ignore-non-numeric range
//! rule.
//!
//! Numeric *collection* still lives in [`crate::common::coercion`]
//! ([`collect_numbers`](crate::common::coercion::collect_numbers));
//! this module owns the math over the collected numbers and the
//! pair-aware collection the two-array functions need.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::value::Value;

/// Members of one argument as `(value, range_derived)` pairs in
/// row-major order — the positional pairing `CORREL`/`SLOPE`/
/// `INTERCEPT` need. Scalars and single refs are one-element vectors.
fn arg_members(ctx: &mut EvalContext<'_>, arg: &Expr) -> Result<Vec<(Value, bool)>, EvalError> {
    Ok(match ctx.eval_arg(arg)? {
        ArgValue::Scalar(v) => vec![(v, false)],
        ArgValue::Ref(v) => vec![(v, true)],
        ArgValue::Range(a) => a.into_iter().map(|v| (v, true)).collect(),
    })
}

/// One member of a paired argument: `Some(n)` for a usable number,
/// `None` for a range member that is ignored (text/boolean/blank) or a
/// scalar that stays non-numeric after coercion, `Err` to propagate.
fn member_number(v: &Value, ranged: bool) -> Result<Option<f64>, CalcError> {
    if let Some(e) = v.error() {
        return Err(e);
    }
    if ranged {
        Ok(match v {
            Value::Number(n) => Some(*n),
            _ => None,
        })
    } else {
        match v.to_number() {
            Ok(n) => Ok(Some(n)),
            Err(e) => Err(e),
        }
    }
}

/// Numeric pairs for the two-array statistics functions.
///
/// Both arguments are flattened to their member cells; a cell-count
/// mismatch is `#N/A` (checked on raw member count, before exclusion —
/// SPEC-OPEN whether Excel compares cell count or post-filter count).
/// A pair survives only when both members are numbers; error members
/// propagate. Scalars follow the direct-argument coercion rules.
pub fn numeric_pairs(
    ctx: &mut EvalContext<'_>,
    arg1: &Expr,
    arg2: &Expr,
) -> Result<Result<Vec<(f64, f64)>, CalcError>, EvalError> {
    let a = arg_members(ctx, arg1)?;
    let b = arg_members(ctx, arg2)?;
    if a.len() != b.len() {
        return Ok(Err(CalcError::NA));
    }
    let mut out = Vec::with_capacity(a.len());
    for ((va, ra), (vb, rb)) in a.iter().zip(b.iter()) {
        let na = match member_number(va, *ra) {
            Ok(n) => n,
            Err(e) => return Ok(Err(e)),
        };
        let nb = match member_number(vb, *rb) {
            Ok(n) => n,
            Err(e) => return Ok(Err(e)),
        };
        if let (Some(x), Some(y)) = (na, nb) {
            out.push((x, y));
        }
    }
    Ok(Ok(out))
}

/// Two-pass sample variance `Σ(x - x̄)² / (n - 1)`.
///
/// Two-pass is chosen over Welford for exactness on typical inputs and
/// simple reasoning about the error bound: with `n` values the mean is
/// exact to one rounding and the deviation sum accumulates `O(n·eps)`
/// relative error, far tighter than the naive `Σx² - n·x̄²` formula
/// under cancellation. `None` when `n < 2` (callers map to `#DIV/0!`).
pub fn sample_variance(nums: &[f64]) -> Option<f64> {
    if nums.len() < 2 {
        return None;
    }
    let mean = nums.iter().sum::<f64>() / nums.len() as f64;
    let ss = nums
        .iter()
        .map(|x| {
            let d = x - mean;
            d * d
        })
        .sum::<f64>();
    Some(ss / (nums.len() - 1) as f64)
}

/// Median of an ascending-sorted, non-empty slice. Uses `f64::midpoint`
/// so extreme opposite-sign magnitudes do not overflow.
pub fn sorted_median(sorted: &[f64]) -> f64 {
    let n = sorted.len();
    let mid = n / 2;
    if n % 2 == 1 {
        sorted[mid]
    } else {
        sorted[mid - 1].midpoint(sorted[mid])
    }
}

/// Inclusive-percentile (`PERCENTILE.INC`) linear interpolation over an
/// ascending-sorted, non-empty slice. Caller bounds-checks `k ∈ [0,1]`.
///
/// Rank `r = k·(n-1)` (0-based): integer `r` selects an element,
/// otherwise interpolate between the floor and ceil elements.
pub fn percentile_inc_sorted(sorted: &[f64], k: f64) -> f64 {
    let n = sorted.len();
    if n == 1 {
        return sorted[0];
    }
    let r = k * (n - 1) as f64;
    let lo = r.floor() as usize;
    if lo >= n - 1 {
        return sorted[n - 1];
    }
    let frac = r - lo as f64;
    sorted[lo] + (sorted[lo + 1] - sorted[lo]) * frac
}

/// Two-pass deviation sums over numeric pairs: the shared accumulator
/// for `CORREL` (`r = sxy / sqrt(sxx·syy)`), `SLOPE`
/// (`b = sxy / sxx`) and `INTERCEPT` (`ȳ - b·x̄`).
///
/// Same stability argument as [`sample_variance`]: the deviation form
/// `Σ((x-x̄)(y-ȳ))` avoids the catastrophic cancellation of the
/// `Σxy - n·x̄·ȳ` shortcut.
#[derive(Debug, Clone, Copy)]
pub struct PairStats {
    pub n: usize,
    pub mean_x: f64,
    pub mean_y: f64,
    /// `Σ(x - x̄)²`
    pub sxx: f64,
    /// `Σ(y - ȳ)²`
    pub syy: f64,
    /// `Σ(x - x̄)(y - ȳ)`
    pub sxy: f64,
}

/// Compute [`PairStats`] for `pairs` (`(x, y)` order — `x` is the
/// independent variable for `SLOPE`/`INTERCEPT`).
pub fn pair_stats(pairs: &[(f64, f64)]) -> PairStats {
    let n = pairs.len();
    let mean_x = pairs.iter().map(|(x, _)| x).sum::<f64>() / n as f64;
    let mean_y = pairs.iter().map(|(_, y)| y).sum::<f64>() / n as f64;
    let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
    for (x, y) in pairs {
        let dx = x - mean_x;
        let dy = y - mean_y;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    PairStats {
        n,
        mean_x,
        mean_y,
        sxx,
        syy,
        sxy,
    }
}

/// Coerce a scalar parameter (a `k`, `quart`, `order`, … argument).
/// Errors map to `Value::Error` at the call site.
pub fn scalar_number(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<f64, CalcError>, EvalError> {
    Ok(ctx.eval(arg)?.to_number())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_variance_two_values() {
        assert_eq!(sample_variance(&[1.0, 3.0]), Some(2.0));
    }

    #[test]
    fn sample_variance_needs_two() {
        assert_eq!(sample_variance(&[5.0]), None);
        assert_eq!(sample_variance(&[]), None);
    }

    #[test]
    fn sample_variance_equal_values() {
        assert_eq!(sample_variance(&[4.0, 4.0, 4.0]), Some(0.0));
    }

    #[test]
    fn sorted_median_odd_even() {
        assert_eq!(sorted_median(&[1.0, 2.0, 3.0]), 2.0);
        assert_eq!(sorted_median(&[1.0, 2.0, 3.0, 10.0]), 2.5);
    }

    #[test]
    fn sorted_median_extreme_no_overflow() {
        assert_eq!(sorted_median(&[-1e308, 1e308]), 0.0);
        assert_eq!(sorted_median(&[1e308, 1e308]), 1e308);
    }

    #[test]
    fn percentile_endpoints_and_interp() {
        let s = [1.0, 2.0, 3.0, 4.0];
        assert_eq!(percentile_inc_sorted(&s, 0.0), 1.0);
        assert_eq!(percentile_inc_sorted(&s, 1.0), 4.0);
        assert_eq!(percentile_inc_sorted(&s, 0.5), 2.5);
        assert_eq!(percentile_inc_sorted(&s, 0.75), 3.25);
    }

    #[test]
    fn percentile_single() {
        assert_eq!(percentile_inc_sorted(&[7.0], 0.3), 7.0);
    }

    #[test]
    fn pair_stats_slope_one() {
        // y = x exactly: sxy == sxx.
        let st = pair_stats(&[(1.0, 1.0), (2.0, 2.0), (3.0, 3.0)]);
        assert_eq!(st.sxx, 2.0);
        assert_eq!(st.syy, 2.0);
        assert_eq!(st.sxy, 2.0);
    }
}
