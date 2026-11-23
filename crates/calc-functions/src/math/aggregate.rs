//! `AGGREGATE(function_num, options, ref1, [ref2], ...)` — applies one
//! of 19 aggregate functions to ranges while optionally ignoring
//! errors. Spec: `docs/functions/AGGREGATE.md`.
//!
//! Limitations vs Excel (no view layer / no nested-subtotal detection
//! in this engine, recorded in the spec's Open questions):
//! - "Hidden rows" (options 1, 3, 5, 7) cannot be detected — those
//!   options behave like their non-hidden counterpart.
//! - "Nested SUBTOTAL/AGGREGATE" (options 0–3) cannot be detected —
//!   that flag is a no-op.
//! - Non-integer `function_num`/`options`/`k` truncate toward zero
//!   (SPEC-OPEN — documented Excel behavior, unconfirmed).
//! - For `function_num` 1–13 every argument after `options` is data;
//!   `k` is required exactly once for 14–19 as the final argument.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::coercion::flatten_args;
use crate::common::statistics::{percentile_inc_sorted, sample_variance, sorted_median};

/// PERCENTILE.EXC/QUARTILE.EXC interpolation over a sorted slice:
/// rank `h = k*(n+1)`, integer `h` selects `sorted[h-1]`, fractional
/// `h` interpolates; `h` outside `(1, n)` -> `None` (`#NUM!`).
fn percentile_exc_sorted(sorted: &[f64], k: f64) -> Option<f64> {
    let n = sorted.len();
    if n < 2 || k <= 0.0 || k >= 1.0 {
        return None;
    }
    let h = k * (n + 1) as f64;
    if h < 1.0 || h > n as f64 {
        return None;
    }
    let lo = h.floor() as usize;
    let frac = h - lo as f64;
    if frac == 0.0 {
        return Some(sorted[lo - 1]);
    }
    // lo < n guaranteed because h < n when non-integer and h <= n.
    if lo >= n {
        return Some(sorted[n - 1]);
    }
    Some(sorted[lo - 1] + (sorted[lo] - sorted[lo - 1]) * frac)
}

/// Most frequent value, first-encountered wins ties; `None` when no
/// value repeats (MODE.SNGL `#N/A`).
fn mode_sngl(nums: &[f64]) -> Option<f64> {
    let mut best: Option<(f64, usize)> = None;
    for (i, &v) in nums.iter().enumerate() {
        if best.is_some_and(|(bv, _)| bv == v) {
            continue;
        }
        if nums[..i].contains(&v) {
            continue;
        }
        let count = nums.iter().filter(|&&x| x == v).count();
        if best.is_none_or(|(_, c)| count > c) {
            best = Some((v, count));
        }
    }
    best.filter(|(_, c)| *c > 1).map(|(v, _)| v)
}

fn aggregate_sorted(nums: &mut [f64], counta: usize, fnum: i64, k: f64) -> Result<f64, CalcError> {
    nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let s: &[f64] = nums;
    let n = s.len();
    let nonempty = || (!s.is_empty()).then_some(()).ok_or(CalcError::Num);
    let k_rank = k.trunc();
    match fnum {
        1 => {
            if n == 0 {
                Err(CalcError::DivZero)
            } else {
                Ok(s.iter().sum::<f64>() / n as f64)
            }
        }
        2 => Ok(n as f64),
        3 => Ok(counta as f64),
        4 => Ok(s.last().copied().unwrap_or(0.0)),
        5 => Ok(s.first().copied().unwrap_or(0.0)),
        6 => Ok(s.iter().product()),
        7 => {
            if n < 2 {
                Err(CalcError::DivZero)
            } else {
                Ok(sample_variance(s).unwrap().sqrt())
            }
        }
        8 => {
            if n == 0 {
                Err(CalcError::DivZero)
            } else {
                let mean = s.iter().sum::<f64>() / n as f64;
                Ok((s.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n as f64).sqrt())
            }
        }
        9 => Ok(s.iter().sum()),
        10 => {
            if n < 2 {
                Err(CalcError::DivZero)
            } else {
                Ok(sample_variance(s).unwrap())
            }
        }
        11 => {
            if n == 0 {
                Err(CalcError::DivZero)
            } else {
                let mean = s.iter().sum::<f64>() / n as f64;
                Ok(s.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n as f64)
            }
        }
        12 => nonempty().map(|()| sorted_median(s)),
        13 => {
            if n == 0 {
                Err(CalcError::Num)
            } else {
                mode_sngl(s).ok_or(CalcError::NA)
            }
        }
        14 => {
            let i = (n as i64) - (k_rank as i64);
            if n == 0 || k_rank < 1.0 || i < 0 {
                Err(CalcError::Num)
            } else {
                Ok(s[i as usize])
            }
        }
        15 => {
            if n == 0 || k_rank < 1.0 || (k_rank as i64) > n as i64 {
                Err(CalcError::Num)
            } else {
                Ok(s[k_rank as usize - 1])
            }
        }
        16 => {
            nonempty()?;
            if !(0.0..=1.0).contains(&k) {
                Err(CalcError::Num)
            } else {
                Ok(percentile_inc_sorted(s, k))
            }
        }
        17 => {
            nonempty()?;
            if !(0.0..=4.0).contains(&k_rank) {
                Err(CalcError::Num)
            } else {
                Ok(percentile_inc_sorted(s, k_rank / 4.0))
            }
        }
        18 => percentile_exc_sorted(s, k).ok_or(CalcError::Num),
        19 => {
            if !(1.0..=3.0).contains(&k_rank) {
                return Err(CalcError::Num);
            }
            percentile_exc_sorted(s, k_rank / 4.0).ok_or(CalcError::Num)
        }
        _ => Err(CalcError::Value),
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 255) {
        return Ok(Value::Error(e));
    }
    let fnum = match ctx.eval(&args[0])?.to_number() {
        Ok(v) => v.trunc(),
        Err(e) => return Ok(Value::Error(e)),
    };
    let options = match ctx.eval(&args[1])?.to_number() {
        Ok(v) => v.trunc(),
        Err(e) => return Ok(Value::Error(e)),
    };
    if !(1.0..=19.0).contains(&fnum) || !(0.0..=7.0).contains(&options) {
        return Ok(Value::Error(CalcError::Value));
    }
    let fnum = fnum as i64;
    // Array form: function_num 14–19 take a final `k`/`quart` argument.
    let (data_args, k) = if fnum >= 14 {
        if args.len() < 4 {
            return Ok(Value::Error(CalcError::Value));
        }
        match ctx.eval(args.last().unwrap())?.to_number() {
            Ok(v) => (&args[2..args.len() - 1], v),
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        (&args[2..], 0.0)
    };
    // options bit 2 (values 2,3,6,7) skips error values.
    let ignore_errors = matches!(options as i64, 2 | 3 | 6 | 7);
    let mut nums: Vec<f64> = Vec::new();
    let mut counta = 0usize;
    for (v, ranged) in flatten_args(ctx, data_args)? {
        let members: Vec<Value> = match v {
            Value::Array(a) => a.into_iter().collect(),
            v => vec![v],
        };
        for m in members {
            if let Some(e) = m.error() {
                if ignore_errors {
                    continue;
                }
                return Ok(Value::Error(e));
            }
            if !m.is_blank() {
                counta += 1;
            }
            if ranged {
                if let Value::Number(x) = m {
                    nums.push(x);
                }
            } else {
                match m.to_number() {
                    Ok(x) => nums.push(x),
                    Err(e) => return Ok(Value::Error(e)),
                }
            }
        }
    }
    match aggregate_sorted(&mut nums, counta, fnum, k) {
        Ok(r) => Ok(Value::Number(r)),
        Err(e) => Ok(Value::Error(e)),
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

    fn data() -> [(&'static str, Value); 3] {
        [("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())]
    }

    #[test]
    fn sum_reference_form() {
        assert_eq!(n(&eval_with(&data(), "=AGGREGATE(9,4,A1:A3)")), 6.0);
    }

    #[test]
    fn max_ignoring_errors() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", Value::Error(CalcError::DivZero)),
                ("A3", 3.0.into()),
            ],
            "=AGGREGATE(4,6,A1:A3)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn error_propagates_when_not_ignored() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", Value::Error(CalcError::DivZero))],
            "=AGGREGATE(4,4,A1:A2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn large_array_form() {
        let v = eval_with(&data(), "=AGGREGATE(14,4,A1:A3,2)");
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn small_and_median() {
        assert_eq!(n(&eval_with(&data(), "=AGGREGATE(15,4,A1:A3,1)")), 1.0);
        assert_eq!(n(&eval_with(&data(), "=AGGREGATE(12,4,A1:A3)")), 2.0);
    }

    #[test]
    fn count_and_counta() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", "x".into())],
            "=AGGREGATE(3,4,A1:A2)",
        );
        assert_eq!(n(&v), 2.0);
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", "x".into())],
            "=AGGREGATE(2,4,A1:A2)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn average_ignores_text_in_range() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", "x".into()), ("A3", 5.0.into())],
            "=AGGREGATE(1,4,A1:A3)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn stdev_var_population() {
        // VAR.P of {1,2,3} = 2/3; STDEV.P = sqrt(2/3).
        let v = eval_with(&data(), "=AGGREGATE(11,4,A1:A3)");
        assert!((n(&v) - 2.0 / 3.0).abs() < 1e-12);
        let v = eval_with(&data(), "=AGGREGATE(8,4,A1:A3)");
        assert!((n(&v) - (2.0f64 / 3.0).sqrt()).abs() < 1e-12);
    }

    #[test]
    fn quartile_and_percentile_inc() {
        let v = eval_with(&data(), "=AGGREGATE(17,4,A1:A3,2)");
        assert_eq!(n(&v), 2.0);
        let v = eval_with(&data(), "=AGGREGATE(16,4,A1:A3,0.5)");
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn quartile_exc() {
        // QUARTILE.EXC of {1,2,3,4,5} quart 2 = median = 3.
        let inputs: Vec<(String, Value)> = (1..=5)
            .map(|i| (format!("A{i}"), Value::Number(i as f64)))
            .collect();
        let refs: Vec<(&str, Value)> = inputs
            .iter()
            .map(|(a, v)| (a.as_str(), v.clone()))
            .collect();
        let v = eval_with(&refs, "=AGGREGATE(19,4,A1:A5,2)");
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn product() {
        assert_eq!(n(&eval_with(&data(), "=AGGREGATE(6,4,A1:A3)")), 6.0);
    }

    #[test]
    fn invalid_function_num_and_options() {
        assert_eq!(
            e(&eval_with(&data(), "=AGGREGATE(0,4,A1:A3)")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval_with(&data(), "=AGGREGATE(20,4,A1:A3)")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval_with(&data(), "=AGGREGATE(9,8,A1:A3)")),
            CalcError::Value
        );
        assert_eq!(
            e(&eval_with(&data(), "=AGGREGATE(9,-1,A1:A3)")),
            CalcError::Value
        );
    }

    #[test]
    fn missing_k_value_error() {
        assert_eq!(
            e(&eval_with(&data(), "=AGGREGATE(14,4,A1:A3)")),
            CalcError::Value
        );
    }

    #[test]
    fn k_out_of_range_num() {
        assert_eq!(
            e(&eval_with(&data(), "=AGGREGATE(14,4,A1:A3,4)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval_with(&data(), "=AGGREGATE(15,4,A1:A3,0)")),
            CalcError::Num
        );
    }

    #[test]
    fn empty_set_errors() {
        // MEDIAN with no numbers -> #NUM!; STDEV.S needs >= 2 numbers.
        let v = eval_with(&[("A1", "x".into())], "=AGGREGATE(12,4,A1:A1)");
        assert_eq!(e(&v), CalcError::Num);
        let v = eval_with(&[("A1", 1.0.into())], "=AGGREGATE(7,4,A1:A1)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn mode_sngl() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 2.0.into())],
            "=AGGREGATE(13,4,A1:A3)",
        );
        assert_eq!(n(&v), 2.0);
        let v = eval_with(&data(), "=AGGREGATE(13,4,A1:A3)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval_with(&data(), r#"=AGGREGATE("9","4",A1:A3)"#)), 6.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(
            e(&eval_with(&data(), r#"=AGGREGATE("x",4,A1:A3)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=AGGREGATE(9,4)")), CalcError::Value);
    }
}
