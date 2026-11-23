//! `AVERAGEIFS(average_range, criteria_range1, criteria1, ...)` — mean of
//! `average_range` cells where every `(criteria_rangeN, criteriaN)` pair
//! matches at the same position. Spec: `docs/functions/AVERAGEIFS.md`.
//!
//! Mirrors `SUMIFS`: no resizing — every criteria range must share
//! `average_range`'s dimensions or the result is `#VALUE!`. Non-numeric
//! cells at matched positions are ignored; zero numeric matches gives
//! `#DIV/0!`.

use crate::common::criteria::{self, all_match, eval_pairs};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    // average_range + 1..127 pairs; the count after average_range is even.
    if let Err(e) = check_arity(args, 3, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    if args.len() % 2 == 0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let avg_range = match criteria::eval_cells(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let pairs = match eval_pairs(ctx, args, 1, avg_range.rows(), avg_range.cols())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };

    let (mut total, mut count) = (0.0, 0usize);
    for (i, cell) in avg_range.cells().iter().enumerate() {
        if !all_match(&pairs, i) {
            continue;
        }
        match cell {
            Value::Number(n) => {
                total += n;
                count += 1;
            }
            // Error at a *matched* position propagates (SUMIFS precedent).
            Value::Error(e) => return Ok(Value::Error(*e)),
            _ => {}
        }
    }
    if count == 0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(total / count as f64))
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
    fn single_pair() {
        // {10,20,30,40} where {1,2,1,2} = 1 -> (10+30)/2.
        assert_eq!(n(&eval("=AVERAGEIFS({10,20,30,40},{1,2,1,2},1)")), 20.0);
    }

    #[test]
    fn two_pair_and() {
        // B={5,15,25,35}, A={1,2,3,4}: >=2 and <=3 -> (15+25)/2.
        let v = eval_with(
            &[
                ("B1", 5.0.into()),
                ("B2", 15.0.into()),
                ("B3", 25.0.into()),
                ("B4", 35.0.into()),
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("A4", 4.0.into()),
            ],
            r#"=AVERAGEIFS(B1:B4,A1:A4,">=2",A1:A4,"<=3")"#,
        );
        assert_eq!(n(&v), 20.0);
    }

    #[test]
    fn no_match_div_zero() {
        assert_eq!(
            e(&eval(r#"=AVERAGEIFS({1,2},{1,2},">5")"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn shape_mismatch_value_error() {
        let v = eval_with(
            &[
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
                ("B4", 4.0.into()),
                ("A1", "x".into()),
                ("A2", "x".into()),
                ("A3", "x".into()),
                ("A4", "x".into()),
            ],
            r#"=AVERAGEIFS(B1:B4,A1:A4,"x",C1:C5,"y")"#,
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn even_arg_count_value_error() {
        assert_eq!(e(&eval("=AVERAGEIFS(A1:A3,B1:B3)")), CalcError::Value);
    }

    #[test]
    fn matched_text_cell_ignored() {
        // Position 1 matches but B1 is text -> only B3 averages.
        let v = eval_with(
            &[
                ("B1", "x".into()),
                ("B2", 20.0.into()),
                ("B3", 30.0.into()),
                ("A1", 1.0.into()),
                ("A2", 0.0.into()),
                ("A3", 1.0.into()),
            ],
            "=AVERAGEIFS(B1:B3,A1:A3,1)",
        );
        assert_eq!(n(&v), 30.0);
    }

    #[test]
    fn error_in_criteria_arg_propagates() {
        assert_eq!(e(&eval("=AVERAGEIFS(A1:A2,B1:B2,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn error_in_avg_range_matched_propagates() {
        let v = eval_with(
            &[
                ("B1", Value::Error(CalcError::NA)),
                ("B2", 4.0.into()),
                ("A1", 1.0.into()),
                ("A2", 0.0.into()),
            ],
            "=AVERAGEIFS(B1:B2,A1:A2,1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn error_in_avg_range_unmatched_skipped() {
        let v = eval_with(
            &[
                ("B1", Value::Error(CalcError::NA)),
                ("B2", 4.0.into()),
                ("A1", 0.0.into()),
                ("A2", 1.0.into()),
            ],
            "=AVERAGEIFS(B1:B2,A1:A2,1)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn text_and_numeric_criteria() {
        let v = eval_with(
            &[
                ("B1", 10.0.into()),
                ("B2", 20.0.into()),
                ("B3", 30.0.into()),
                ("A1", "x".into()),
                ("A2", "x".into()),
                ("A3", "y".into()),
                ("C1", 5.0.into()),
                ("C2", 1.0.into()),
                ("C3", 5.0.into()),
            ],
            r#"=AVERAGEIFS(B1:B3,A1:A3,"x",C1:C3,">2")"#,
        );
        assert_eq!(n(&v), 10.0);
    }

    #[test]
    fn all_positions_match() {
        let v = n(&eval(r#"=AVERAGEIFS({2,4,6},{1,1,1},"=1")"#));
        assert_eq!(v, 4.0);
    }

    #[test]
    fn too_few_args_arity_error() {
        assert!(matches!(eval("=AVERAGEIFS(A1:A2)"), Value::Error(_)));
    }
}
