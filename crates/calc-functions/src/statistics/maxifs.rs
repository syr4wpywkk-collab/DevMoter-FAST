//! `MAXIFS(max_range, criteria_range1, criteria1, ...)` — maximum of
//! `max_range` cells where every `(criteria_rangeN, criteriaN)` pair
//! matches at the same position. Spec: `docs/functions/MAXIFS.md`.
//!
//! Same criteria grammar as `SUMIFS` (see `crate::common::criteria`);
//! every criteria range must share `max_range`'s dimensions or the
//! result is `#VALUE!`. No matching numeric cell returns `0`.

use crate::common::criteria::{self, Criterion};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

/// Evaluate `(criteria_range, criteria)` pairs starting at `start`,
/// enforcing `rows`x`cols` dimensions. Mirrors `SUMIFS`' pair loop; it
/// lives here (and in `MINIFS`) rather than reaching into
/// `aggregate::sumifs`, whose module is private to that category.
pub(crate) fn eval_pairs(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    start: usize,
    rows: u32,
    cols: u32,
) -> Result<Result<Vec<(ArrayValue, Criterion)>, CalcError>, EvalError> {
    let mut pairs = Vec::new();
    let mut i = start;
    while i + 1 < args.len() {
        let cells = match criteria::eval_cells(ctx, &args[i])? {
            Err(e) => return Ok(Err(e)),
            Ok(a) => a,
        };
        if cells.rows() != rows || cells.cols() != cols {
            return Ok(Err(CalcError::Value));
        }
        let crit = match criteria::eval_criterion(ctx, &args[i + 1])? {
            Err(e) => return Ok(Err(e)),
            Ok(c) => c,
        };
        pairs.push((cells, crit));
        i += 2;
    }
    Ok(Ok(pairs))
}

/// All pairs match position `i`.
pub(crate) fn all_match(pairs: &[(ArrayValue, Criterion)], i: usize) -> bool {
    pairs.iter().all(|(cells, c)| c.matches(&cells.cells()[i]))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    // max_range + 1..127 pairs; the count after max_range must be even.
    if let Err(e) = check_arity(args, 3, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    if args.len() % 2 == 0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let max_range = match criteria::eval_cells(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let pairs = match eval_pairs(ctx, args, 1, max_range.rows(), max_range.cols())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };

    let mut best: Option<f64> = None;
    for (i, cell) in max_range.cells().iter().enumerate() {
        if !all_match(&pairs, i) {
            continue;
        }
        match cell {
            Value::Number(x) => best = Some(best.map_or(*x, |b: f64| b.max(*x))),
            Value::Error(e) => return Ok(Value::Error(*e)),
            _ => {}
        }
    }
    // No matching numeric cells -> 0 (documented MAXIFS behavior).
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
        // MAXIFS(B1:B4, A1:A4, ">10"), A=11,5,12,9, B=1,2,3,4 -> 3.
        let v = eval_with(
            &[
                ("A1", 11.0.into()),
                ("A2", 5.0.into()),
                ("A3", 12.0.into()),
                ("A4", 9.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
                ("B4", 4.0.into()),
            ],
            r#"=MAXIFS(B1:B4,A1:A4,">10")"#,
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
            r#"=MAXIFS(C1:C3,A1:A3,"x",B1:B3,">0")"#,
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
            r#"=MAXIFS(A1:A3,B1:B3,">=1",A1:A3,"<=20")"#,
        );
        assert_eq!(n(&v), 15.0);
    }

    #[test]
    fn no_match_zero() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", "zzz".into())],
            r#"=MAXIFS(A1:A2,B1:B2,"qqq")"#,
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn negative_max() {
        let v = eval_with(
            &[
                ("A1", (-5.0).into()),
                ("A2", (-2.0).into()),
                ("B1", "x".into()),
                ("B2", "x".into()),
            ],
            r#"=MAXIFS(A1:A2,B1:B2,"x")"#,
        );
        assert_eq!(n(&v), -2.0);
    }

    #[test]
    fn text_in_max_range_ignored() {
        let v = eval_with(
            &[
                ("A1", "t".into()),
                ("A2", 4.0.into()),
                ("B1", "x".into()),
                ("B2", "x".into()),
            ],
            r#"=MAXIFS(A1:A2,B1:B2,"x")"#,
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn only_text_matched_zero() {
        let v = eval_with(
            &[("A1", "t".into()), ("B1", "x".into())],
            r#"=MAXIFS(A1:A2,B1:B2,"x")"#,
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn mismatched_dims_value_error() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("B1", "x".into())],
            r#"=MAXIFS(A1:A2,B1:B1,"x")"#,
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn even_arg_count_value_error() {
        assert_eq!(e(&eval("=MAXIFS(A1:A2,B1:B2)")), CalcError::Value);
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
            r#"=MAXIFS(A1:A2,B1:B2,"x")"#,
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn error_in_criteria_range_never_matches() {
        let v = eval_with(
            &[
                ("A1", 7.0.into()),
                ("B1", Value::Error(CalcError::NA)),
                ("A2", 3.0.into()),
                ("B2", 1.0.into()),
            ],
            r#"=MAXIFS(A1:A2,B1:B2,">=1")"#,
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn error_criterion_arg_propagates() {
        assert_eq!(e(&eval("=MAXIFS(A1:A2,B1:B2,1/0)")), CalcError::DivZero);
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
                ("A3", 9.0.into()),
            ],
            r#"=MAXIFS(A1:A3,B1:B3,"a*")"#,
        );
        assert_eq!(n(&v), 8.0);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=MAXIFS(A1:A2)")), CalcError::Value);
    }
}
