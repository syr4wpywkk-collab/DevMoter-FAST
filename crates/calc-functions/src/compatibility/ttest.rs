//! `TTEST(array1, array2, tails, type)` — legacy Student's t-test
//! probability. Spec: `docs/functions/TTEST.md`.
//!
//! Identical signature and semantics to `T.TEST`: `tails`/`type`
//! truncated; `type` 1 (paired), 2 (pooled), 3 (Welch). Paired uses
//! the shared pair-exclusion rules; unequal raw member counts ->
//! `#N/A`. The one-tailed p uses `|t|` (the convention the spec's
//! worked examples assume). Insufficient data or a zero standard
//! error -> `#DIV/0!`.

use crate::common::{coercion, numerics, statistics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Mean plus two-pass sample variance for one array's numbers.
fn mean_var(nums: &[f64]) -> Option<(f64, f64)> {
    let v = statistics::sample_variance(nums)?;
    Some((nums.iter().sum::<f64>() / nums.len() as f64, v))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 4) {
        return Ok(Value::Error(e));
    }
    let (t, df) = {
        // Array errors win over a bad tails value: the statistic is
        // computed before `tails` is validated, matching T.TEST's
        // argument-order convention.
        let ty = match statistics::scalar_number(ctx, &args[3])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(n) => n.trunc() as i64,
        };
        match ty {
            1 => {
                let pairs = match statistics::numeric_pairs(ctx, &args[0], &args[1])? {
                    Err(e) => return Ok(Value::Error(e)),
                    Ok(p) => p,
                };
                let diffs: Vec<f64> = pairs.iter().map(|(x, y)| x - y).collect();
                let Some((m, v)) = mean_var(&diffs) else {
                    return Ok(Value::Error(CalcError::DivZero));
                };
                if v == 0.0 {
                    return Ok(Value::Error(CalcError::DivZero));
                }
                let df = diffs.len() as f64 - 1.0;
                (m / (v.sqrt() / (diffs.len() as f64).sqrt()), df)
            }
            2 | 3 => {
                let a = match coercion::collect_numbers(ctx, &args[0..1])? {
                    Err(e) => return Ok(Value::Error(e)),
                    Ok(a) => a,
                };
                let b = match coercion::collect_numbers(ctx, &args[1..2])? {
                    Err(e) => return Ok(Value::Error(e)),
                    Ok(b) => b,
                };
                let (Some((m1, v1)), Some((m2, v2))) = (mean_var(&a), mean_var(&b)) else {
                    return Ok(Value::Error(CalcError::DivZero));
                };
                let (n1, n2) = (a.len() as f64, b.len() as f64);
                if ty == 2 {
                    let df = n1 + n2 - 2.0;
                    let sp2 = ((n1 - 1.0) * v1 + (n2 - 1.0) * v2) / df;
                    let se2 = sp2 * (1.0 / n1 + 1.0 / n2);
                    if se2 <= 0.0 {
                        return Ok(Value::Error(CalcError::DivZero));
                    }
                    ((m1 - m2) / se2.sqrt(), df)
                } else {
                    let (u1, u2) = (v1 / n1, v2 / n2);
                    let se2 = u1 + u2;
                    if se2 <= 0.0 {
                        return Ok(Value::Error(CalcError::DivZero));
                    }
                    let df = se2 * se2 / (u1 * u1 / (n1 - 1.0) + u2 * u2 / (n2 - 1.0));
                    ((m1 - m2) / se2.sqrt(), df)
                }
            }
            _ => return Ok(Value::Error(CalcError::Num)),
        }
    };
    let tails = match statistics::scalar_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n.trunc() as i64,
    };
    let p1 = numerics::t_sf(t.abs(), df);
    if p1.is_nan() {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(match tails {
        1 => p1,
        2 => (2.0 * p1).min(1.0),
        _ => return Ok(Value::Error(CalcError::Num)),
    }))
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

    // Microsoft's documented TTEST example arrays (the spec doc's
    // example arrays do not reproduce its stated 0.196016 — recorded
    // as a spec-open fixture case).
    const A: &str = "{3;4;5;8;9;1;2;4;5}";
    const B: &str = "{6;19;3;2;14;4;5;17;1}";

    #[test]
    fn doc_example_paired_two_tail() {
        // Excel doc: TTEST(A,B,2,1) = 0.196016.
        let v = n(&eval(&format!("=TTEST({A},{B},2,1)")));
        assert!((v - 0.1960158).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn paired_one_tail_half() {
        let v = n(&eval(&format!("=TTEST({A},{B},1,1)")));
        assert!((v - 0.0980079).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn pooled_type_2() {
        // pooled two-sample, df 16: p = 0.191996
        let v = n(&eval(&format!("=TTEST({A},{B},2,2)")));
        assert!((v - 0.1919959).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn welch_type_3() {
        // Welch df ~10.255: p = 0.202294
        let v = n(&eval(&format!("=TTEST({A},{B},2,3)")));
        assert!((v - 0.2022939).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn matches_t_test() {
        assert_eq!(
            n(&eval(&format!("=TTEST({A},{B},2,1)"))),
            n(&eval(&format!("=T.TEST({A},{B},2,1)")))
        );
        assert_eq!(
            n(&eval(&format!("=TTEST({A},{B},2,3)"))),
            n(&eval(&format!("=T.TEST({A},{B},2,3)")))
        );
    }

    #[test]
    fn paired_unequal_counts_na() {
        assert_eq!(e(&eval("=TTEST({1,2,3},{1,2,3,4},2,1)")), CalcError::NA);
    }

    #[test]
    fn type_out_of_range_num() {
        assert_eq!(e(&eval("=TTEST({1,2,3},{1,2,3},2,4)")), CalcError::Num);
        assert_eq!(e(&eval("=TTEST({1,2,3},{1,2,3},2,0)")), CalcError::Num);
    }

    #[test]
    fn tails_out_of_range_num() {
        assert_eq!(e(&eval("=TTEST({1,2,3},{2,3,5},3,1)")), CalcError::Num);
        assert_eq!(e(&eval("=TTEST({1,2,3},{2,3,5},0,1)")), CalcError::Num);
    }

    #[test]
    fn identical_arrays_div_zero() {
        // Zero variance in the differences -> undefined t.
        assert_eq!(e(&eval("=TTEST({1,2,3},{1,2,3},2,1)")), CalcError::DivZero);
    }

    #[test]
    fn insufficient_data_div_zero() {
        assert_eq!(e(&eval("=TTEST({1},{2},2,2)")), CalcError::DivZero);
    }

    #[test]
    fn tails_and_type_truncate() {
        assert_eq!(
            n(&eval(&format!("=TTEST({A},{B},2.9,1.9)"))),
            n(&eval(&format!("=TTEST({A},{B},2,1)")))
        );
    }

    #[test]
    fn error_in_array_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::Ref))],
            "=TTEST(A1:A3,{1,2,3},2,1)",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }

    #[test]
    fn range_elements_ignore_text() {
        let v = eval_with(
            &[
                ("A1", Value::Number(6.0)),
                ("A2", Value::Text("x".into())),
                ("A3", Value::Number(9.0)),
                ("B1", Value::Number(20.0)),
                ("B2", Value::Number(28.0)),
            ],
            "=TTEST(A1:A3,B1:B2,2,2)",
        );
        assert!(matches!(v, Value::Number(_)), "got {v:?}");
    }
}
