//! `T.TEST(array1, array2, tails, type)` — probability of a Student's
//! t-test. Spec: `docs/functions/T.TEST.md`.
//!
//! `tails`/`type` are truncated toward zero; `tails` must be 1 or 2,
//! `type` 1 (paired), 2 (pooled two-sample) or 3 (Welch). Paired uses
//! the shared pair-exclusion rules; unequal raw member counts -> `#N/A`.
//! The one-tailed p uses `|t|` (the convention the spec's worked
//! examples assume — sign-aware tails are a recorded open question).
//! Insufficient data or a zero standard error -> `#DIV/0!`.

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
        // `tails`/`type` are evaluated after the arrays in Excel's
        // argument order; array errors therefore win over a bad tails
        // value. Compute the statistic first.
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

    const X: &str = "{3;4;5;8;9;1;2;4;5}";
    const Y: &str = "{6;19;3;2;14;4;5;17;1}";

    #[test]
    fn excel_doc_paired_two_tail() {
        // Excel doc: T.TEST(x, y, 2, 1) = 0.196016
        let v = n(&eval(&format!("=T.TEST({X},{Y},2,1)")));
        assert!((v - 0.1960158).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn paired_one_tail() {
        let v = n(&eval(&format!("=T.TEST({X},{Y},1,1)")));
        assert!((v - 0.0980079).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn pooled_two_sample() {
        // type=2 pooled: p = 0.191996 (df 16)
        let v = n(&eval(&format!("=T.TEST({X},{Y},2,2)")));
        assert!((v - 0.1919959).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn welch_two_sample() {
        // type=3 Welch: p = 0.202294 (df ~10.255)
        let v = n(&eval(&format!("=T.TEST({X},{Y},2,3)")));
        assert!((v - 0.2022939).abs() < 1e-6, "got {v}");
    }

    #[test]
    fn paired_unequal_counts_na() {
        assert_eq!(e(&eval("=T.TEST({1;2;3},{1;2},2,1)")), CalcError::NA);
    }

    #[test]
    fn paired_drops_nonnumeric_pairs() {
        // A1/A3 numeric vs B-col: B2 text drops pair 2 -> pairs (1,5),(9,7)
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 4.0.into()),
                ("A3", 9.0.into()),
                ("B1", 5.0.into()),
                ("B2", "x".into()),
                ("B3", 7.0.into()),
            ],
            "=T.TEST(A1:A3,B1:B3,2,1)",
        );
        // diffs {-4, 2}: mean -1, sd ~4.243, t=-1/3, df=1 -> p2 ~0.795167
        assert!((n(&v) - 0.7951672).abs() < 1e-6, "got {}", n(&v));
    }

    #[test]
    fn bad_tails_num() {
        assert_eq!(e(&eval(&format!("=T.TEST({X},{Y},3,1)"))), CalcError::Num);
    }

    #[test]
    fn bad_type_num() {
        assert_eq!(e(&eval(&format!("=T.TEST({X},{Y},2,4)"))), CalcError::Num);
    }

    #[test]
    fn tails_and_type_truncate() {
        // 2.9 -> 2, 1.9 -> 1: same as (2,1)
        let a = n(&eval(&format!("=T.TEST({X},{Y},2.9,1.9)")));
        let b = n(&eval(&format!("=T.TEST({X},{Y},2,1)")));
        assert_eq!(a, b);
    }

    #[test]
    fn two_sample_unequal_sizes() {
        let v = n(&eval("=T.TEST({1;2;3;4},{2;4;6},2,2)"));
        assert!(v > 0.0 && v < 1.0, "got {v}");
    }

    #[test]
    fn insufficient_data_div_zero() {
        // One value per side: no variance -> #DIV/0!
        assert_eq!(e(&eval("=T.TEST({1},{2},2,2)")), CalcError::DivZero);
    }

    #[test]
    fn constant_paired_diffs_div_zero() {
        // Identical arrays -> sd(d)=0 -> #DIV/0!
        assert_eq!(e(&eval("=T.TEST({1;2;3},{1;2;3},2,1)")), CalcError::DivZero);
    }

    #[test]
    fn non_numeric_tails_value() {
        assert_eq!(
            e(&eval(&format!(r#"=T.TEST({X},{Y},"x",1)"#))),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=T.TEST({1/0;2},{1;2},2,1)")), CalcError::DivZero);
    }
}
