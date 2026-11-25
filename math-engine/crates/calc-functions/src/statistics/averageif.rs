//! `AVERAGEIF(range, criteria, [average_range])` — mean of `average_range`
//! (or `range`) cells at positions where `range` matches `criteria`.
//! Spec: `docs/functions/AVERAGEIF.md`.
//!
//! Mirrors `SUMIF` — including `average_range` resizing via
//! [`criteria::eval_resized_range`] — but returns the mean and errors
//! `#DIV/0!` when no matching position holds a number.

use crate::common::criteria;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let range = match criteria::eval_cells(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let crit = match criteria::eval_criterion(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(c) => c,
    };
    let avg_cells = if args.len() == 3 {
        match criteria::eval_resized_range(ctx, &args[2], range.rows(), range.cols())? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(a) => a,
        }
    } else {
        range.clone()
    };

    let (mut total, mut count) = (0.0, 0usize);
    for (i, cell) in range.cells().iter().enumerate() {
        if !crit.matches(cell) {
            continue;
        }
        match avg_cells.cells().get(i) {
            Some(Value::Number(n)) => {
                total += n;
                count += 1;
            }
            // Error at a *matched* position propagates (SUMIF precedent).
            Some(Value::Error(e)) => return Ok(Value::Error(*e)),
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
    fn numeric_criterion_gt() {
        let v = n(&eval(r#"=AVERAGEIF({1,2,3,4},">2")"#));
        assert_eq!(v, 3.5);
    }

    #[test]
    fn text_match_with_average_range() {
        let v = eval_with(
            &[
                ("A1", "x".into()),
                ("A2", "y".into()),
                ("A3", "x".into()),
                ("A4", "y".into()),
                ("B1", 10.0.into()),
                ("B2", 20.0.into()),
                ("B3", 30.0.into()),
                ("B4", 40.0.into()),
            ],
            r#"=AVERAGEIF(A1:A4,"x",B1:B4)"#,
        );
        assert_eq!(n(&v), 20.0);
    }

    #[test]
    fn no_match_div_zero() {
        assert_eq!(e(&eval(r#"=AVERAGEIF({1,2,3},">10")"#)), CalcError::DivZero);
    }

    #[test]
    fn average_range_omitted_uses_range() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", 4.0.into())],
            "=AVERAGEIF(A1:A3,2)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn average_range_resized_from_single_cell() {
        // B1 anchors a 3x1 average range; positions 2,3 match -> (20+30)/2.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 10.0.into()),
                ("B2", 20.0.into()),
                ("B3", 30.0.into()),
            ],
            r#"=AVERAGEIF(A1:A3,">1",B1)"#,
        );
        assert_eq!(n(&v), 25.0);
    }

    #[test]
    fn matched_text_cell_not_counted() {
        // Position 2 matches but B2 is text -> only B1 averages.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", 10.0.into()),
                ("B2", "x".into()),
            ],
            r#"=AVERAGEIF(A1:A2,">0",B1:B2)"#,
        );
        assert_eq!(n(&v), 10.0);
    }

    #[test]
    fn matched_blank_cell_not_counted() {
        let v = eval_with(
            &[("A1", 5.0.into()), ("A2", 5.0.into())],
            "=AVERAGEIF(A1:A2,5,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn wildcard_criterion() {
        let v = eval_with(
            &[
                ("A1", "apple".into()),
                ("A2", "banana".into()),
                ("A3", "grape".into()),
                ("B1", 3.0.into()),
                ("B2", 6.0.into()),
                ("B3", 9.0.into()),
            ],
            r#"=AVERAGEIF(A1:A3,"*e",B1:B3)"#,
        );
        assert_eq!(n(&v), 6.0);
    }

    #[test]
    fn error_in_criteria_arg_propagates() {
        assert_eq!(e(&eval("=AVERAGEIF(A1:A3,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn error_in_avg_range_matched_propagates() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", (-1.0).into()),
                ("B1", Value::Error(CalcError::DivZero)),
                ("B2", 5.0.into()),
            ],
            r#"=AVERAGEIF(A1:A2,">0",B1:B2)"#,
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn error_in_avg_range_unmatched_skipped() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", (-1.0).into()),
                ("B1", 10.0.into()),
                ("B2", Value::Error(CalcError::DivZero)),
            ],
            r#"=AVERAGEIF(A1:A2,">0",B1:B2)"#,
        );
        assert_eq!(n(&v), 10.0);
    }

    #[test]
    fn cell_ref_criterion() {
        let v = eval_with(
            &[("A1", 4.0.into()), ("A2", 8.0.into()), ("D1", 4.0.into())],
            "=AVERAGEIF(A1:A2,D1)",
        );
        assert_eq!(n(&v), 4.0);
    }
}
