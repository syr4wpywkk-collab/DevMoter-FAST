//! `SUMIFS(sum_range, criteria_range1, criteria1, ...)` — sums `sum_range`
//! cells where every `(criteria_rangeN, criteriaN)` pair matches at the
//! same position. Spec: `docs/functions/SUMIFS.md`.
//!
//! Unlike `SUMIF` there is no resizing: every criteria range must share
//! `sum_range`'s dimensions or the result is `#VALUE!`.

use crate::common::criteria::{self, Criterion};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

/// Evaluate `pairs` of `(criteria_range, criteria)` args starting at
/// `start`, enforcing `rows`x`cols` dimensions. `Err(CalcError)` is the
/// function result on a bad pair.
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
    // sum_range + 1..127 pairs; the count after sum_range must be even.
    if let Err(e) = check_arity(args, 3, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    if args.len() % 2 == 0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let sum_range = match criteria::eval_cells(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let pairs = match eval_pairs(ctx, args, 1, sum_range.rows(), sum_range.cols())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };

    let mut total = 0.0;
    for (i, cell) in sum_range.cells().iter().enumerate() {
        if !all_match(&pairs, i) {
            continue;
        }
        match cell {
            Value::Number(n) => total += n,
            Value::Error(e) => return Ok(Value::Error(*e)),
            _ => {}
        }
    }
    Ok(Value::Number(total))
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
    fn two_pair_and() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("A4", 4.0.into()),
                ("B1", "x".into()),
                ("B2", "x".into()),
                ("B3", "y".into()),
                ("B4", "x".into()),
                ("C1", 10.0.into()),
                ("C2", 20.0.into()),
                ("C3", 30.0.into()),
                ("C4", 40.0.into()),
            ],
            r#"=SUMIFS(C1:C4,A1:A4,">1",B1:B4,"x")"#,
        );
        assert_eq!(n(&v), 60.0);
    }

    #[test]
    fn mismatched_range_dims_value_error() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", "x".into()),
                ("B2", "x".into()),
                ("C1", 1.0.into()),
            ],
            r#"=SUMIFS(C1:C3,A1:A3,">0",B1:B2,"x")"#,
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn even_arg_count_errors() {
        assert_eq!(e(&eval("=SUMIFS(C1:C3,A1:A3)")), CalcError::Value);
    }

    #[test]
    fn wildcard_and_numeric_pairs() {
        let v = eval_with(
            &[
                ("A1", "apple".into()),
                ("A2", "avocado".into()),
                ("A3", "banana".into()),
                ("B1", 6.0.into()),
                ("B2", 4.0.into()),
                ("B3", 9.0.into()),
                ("C1", 1.0.into()),
                ("C2", 2.0.into()),
                ("C3", 3.0.into()),
            ],
            r#"=SUMIFS(C1:C3,A1:A3,"a*",B1:B3,">5")"#,
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn cell_ref_criterion() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 2.0.into()),
                ("B1", 10.0.into()),
                ("B2", 20.0.into()),
                ("B3", 30.0.into()),
                ("D1", 2.0.into()),
            ],
            "=SUMIFS(B1:B3,A1:A3,D1)",
        );
        assert_eq!(n(&v), 50.0);
    }

    #[test]
    fn contradictory_criteria_give_zero() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 6.0.into()), ("B1", 1.0.into())],
            r#"=SUMIFS(B1:B2,A1:A2,">5",A1:A2,"<2")"#,
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn no_match_gives_zero() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 5.0.into())],
            r#"=SUMIFS(B1:B2,A1:A2,">99")"#,
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn same_range_two_pairs() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 5.0.into()),
            ],
            r#"=SUMIFS(B1:B3,A1:A3,">0",A1:A3,"<3")"#,
        );
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn error_in_sum_range_matched_propagates() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", Value::Error(CalcError::DivZero)),
                ("B2", 5.0.into()),
            ],
            r#"=SUMIFS(B1:B2,A1:A2,">0")"#,
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn error_in_criteria_arg_propagates() {
        assert_eq!(e(&eval("=SUMIFS(B1:B2,A1:A2,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn nonblank_criterion() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", "a".into()),
                // B2 left blank: "<>" does not match it.
                ("C1", 5.0.into()),
                ("C2", 7.0.into()),
            ],
            r#"=SUMIFS(C1:C2,A1:A2,">=1",B1:B2,"<>")"#,
        );
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn error_in_criteria_range_skipped() {
        let v = eval_with(
            &[
                ("A1", Value::Error(CalcError::NA)),
                ("A2", 1.0.into()),
                ("B1", 9.0.into()),
                ("B2", 4.0.into()),
            ],
            r#"=SUMIFS(B1:B2,A1:A2,">0")"#,
        );
        assert_eq!(n(&v), 4.0);
    }
}
