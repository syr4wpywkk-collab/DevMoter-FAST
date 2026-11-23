//! `MINIFS(min_range, criteria_range1, criteria1, ...)` — minimum of
//! `min_range` cells where every `(criteria_rangeN, criteriaN)` pair
//! matches at the same position. Mirror of `MAXIFS`.
//! Spec: `docs/functions/MINIFS.md`.

use crate::common::criteria;
use crate::statistics::maxifs::{all_match, eval_pairs};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    // min_range + 1..127 pairs; the count after min_range must be even.
    if let Err(e) = check_arity(args, 3, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    if args.len() % 2 == 0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let min_range = match criteria::eval_cells(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let pairs = match eval_pairs(ctx, args, 1, min_range.rows(), min_range.cols())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };

    let mut best: Option<f64> = None;
    for (i, cell) in min_range.cells().iter().enumerate() {
        if !all_match(&pairs, i) {
            continue;
        }
        match cell {
            Value::Number(x) => best = Some(best.map_or(*x, |b: f64| b.min(*x))),
            Value::Error(e) => return Ok(Value::Error(*e)),
            _ => {}
        }
    }
    // No matching numeric cells -> 0 (documented MINIFS behavior).
    Ok(Value::Number(best.unwrap_or(0.0)))
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
        // MINIFS(B1:B4, A1:A4, ">10"), A=11,5,12,9, B=4,2,3,8 -> 3.
        let v = eval_with(
            &[
                ("A1", 11.0.into()),
                ("A2", 5.0.into()),
                ("A3", 12.0.into()),
                ("A4", 9.0.into()),
                ("B1", 4.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
                ("B4", 8.0.into()),
            ],
            r#"=MINIFS(B1:B4,A1:A4,">10")"#,
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn two_pairs_and() {
        let v = eval_with(
            &[
                ("A1", "x".into()),
                ("A2", "x".into()),
                ("A3", "y".into()),
                ("B1", 5.0.into()),
                ("B2", (-1.0).into()),
                ("B3", 9.0.into()),
                ("C1", 10.0.into()),
                ("C2", 20.0.into()),
                ("C3", 30.0.into()),
            ],
            r#"=MINIFS(C1:C3,A1:A3,"x",B1:B3,">0")"#,
        );
        assert_eq!(n(&v), 10.0);
    }

    #[test]
    fn band_on_same_range() {
        let v = eval_with(
            &[
                ("A1", 5.0.into()),
                ("A2", 15.0.into()),
                ("A3", 25.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            r#"=MINIFS(A1:A3,B1:B3,">=1",A1:A3,"<=20")"#,
        );
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn no_match_zero() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", "zzz".into())],
            r#"=MINIFS(A1:A2,B1:B2,"qqq")"#,
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn negative_min() {
        let v = eval_with(
            &[
                ("A1", (-5.0).into()),
                ("A2", (-2.0).into()),
                ("B1", "x".into()),
                ("B2", "x".into()),
            ],
            r#"=MINIFS(A1:A2,B1:B2,"x")"#,
        );
        assert_eq!(n(&v), -5.0);
    }

    #[test]
    fn text_in_min_range_ignored() {
        let v = eval_with(
            &[
                ("A1", "t".into()),
                ("A2", 4.0.into()),
                ("B1", "x".into()),
                ("B2", "x".into()),
            ],
            r#"=MINIFS(A1:A2,B1:B2,"x")"#,
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn mismatched_dims_value_error() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("B1", "x".into())],
            r#"=MINIFS(A1:A2,B1:B1,"x")"#,
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn even_arg_count_value_error() {
        assert_eq!(e(&eval("=MINIFS(A1:A2,B1:B2)")), CalcError::Value);
    }

    #[test]
    fn matched_error_propagates() {
        let v = eval_with(
            &[
                ("A1", Value::Error(CalcError::DivZero)),
                ("A2", 1.0.into()),
                ("B1", "x".into()),
                ("B2", "x".into()),
            ],
            r#"=MINIFS(A1:A2,B1:B2,"x")"#,
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn wildcard_criterion() {
        let v = eval_with(
            &[
                ("B1", "apple".into()),
                ("B2", "avocado".into()),
                ("B3", "banana".into()),
                ("A1", 1.0.into()),
                ("A2", 8.0.into()),
                ("A3", 2.0.into()),
            ],
            r#"=MINIFS(A1:A3,B1:B3,"a*")"#,
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn cell_ref_criterion() {
        let v = eval_with(
            &[
                ("A1", 7.0.into()),
                ("A2", 4.0.into()),
                ("A3", 4.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
                ("D1", 2.0.into()),
            ],
            "=MINIFS(A1:A3,B1:B3,D1)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=MINIFS(A1:A2)")), CalcError::Value);
    }
}
