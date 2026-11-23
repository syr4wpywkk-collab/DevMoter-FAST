//! `SUMIF(range, criteria, [sum_range])` — sums cells in `range` matching
//! `criteria`; when `sum_range` is given, sums its cells at the positions
//! where `range` matches. Spec: `docs/functions/SUMIF.md`.
//!
//! `sum_range` is resized to `range`'s shape anchored at its own top-left
//! cell (Excel's documented rule), via [`criteria::eval_resized_range`].

use crate::common::criteria;
use calc_core::ast::Expr;
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
    let sum_cells = if args.len() == 3 {
        match criteria::eval_resized_range(ctx, &args[2], range.rows(), range.cols())? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(a) => a,
        }
    } else {
        range.clone()
    };

    let mut total = 0.0;
    for (i, cell) in range.cells().iter().enumerate() {
        if !crit.matches(cell) {
            continue;
        }
        match sum_cells.cells().get(i) {
            Some(Value::Number(n)) => total += n,
            // Error at a *matched* position propagates (SUMIF.md).
            Some(Value::Error(e)) => return Ok(Value::Error(*e)),
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
    fn numeric_criterion_gt() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("A4", 4.0.into()),
            ],
            r#"=SUMIF(A1:A4,">2")"#,
        );
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn text_equality_case_insensitive() {
        let v = eval_with(
            &[
                ("A1", "apple".into()),
                ("A2", "APPLE".into()),
                ("A3", "banana".into()),
                ("A4", "Apple".into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
                ("B4", 4.0.into()),
            ],
            r#"=SUMIF(A1:A4,"APPLE",B1:B4)"#,
        );
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn sum_range_omitted_uses_range() {
        let v = eval_with(&[("A1", 2.0.into()), ("A2", 2.0.into())], "=SUMIF(A1:A3,2)");
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn sum_range_resized_from_single_cell() {
        // B1 anchors a 3x1 sum range: positions 2,3 match -> B2+B3.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 10.0.into()),
                ("B2", 20.0.into()),
                ("B3", 30.0.into()),
            ],
            r#"=SUMIF(A1:A3,">1",B1)"#,
        );
        assert_eq!(n(&v), 50.0);
    }

    #[test]
    fn wildcard_criterion() {
        let v = eval_with(
            &[
                ("A1", "apple".into()),
                ("A2", "banana".into()),
                ("A3", "grape".into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            r#"=SUMIF(A1:A3,"*e",B1:B3)"#,
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn escaped_wildcard_literal() {
        let v = eval_with(
            &[
                ("A1", "*".into()),
                ("A2", "a*".into()),
                ("B1", 5.0.into()),
                ("B2", 6.0.into()),
            ],
            r#"=SUMIF(A1:A2,"~*",B1:B2)"#,
        );
        assert_eq!(n(&v), 5.0);
    }

    #[test]
    fn cell_ref_criterion() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 2.0.into()),
                ("D1", 2.0.into()),
            ],
            "=SUMIF(A1:A3,D1)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn cell_ref_criterion_parses_text() {
        // A criteria cell holding ">5" is parsed with the same grammar.
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 9.0.into()), ("D1", ">5".into())],
            "=SUMIF(A1:A2,D1)",
        );
        assert_eq!(n(&v), 9.0);
    }

    #[test]
    fn no_match_gives_zero() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into())],
            r#"=SUMIF(A1:A2,">99")"#,
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn error_in_criteria_arg_propagates() {
        assert_eq!(e(&eval("=SUMIF(A1:A3,1/0)")), CalcError::DivZero);
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
            r#"=SUMIF(A1:A2,">0",B1:B2)"#,
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn error_in_sum_range_unmatched_skipped() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", (-1.0).into()),
                ("B1", 10.0.into()),
                ("B2", Value::Error(CalcError::DivZero)),
            ],
            r#"=SUMIF(A1:A2,">0",B1:B2)"#,
        );
        assert_eq!(n(&v), 10.0);
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=SUMIF(A1:A3)")), CalcError::Value);
        assert_eq!(e(&eval("=SUMIF(A1:A3,1,B1:B3,4)")), CalcError::Value);
    }
}
