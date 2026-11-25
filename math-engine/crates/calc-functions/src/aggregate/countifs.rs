//! `COUNTIFS(criteria_range1, criteria1, ...)` — counts positions where
//! every `(criteria_rangeN, criteriaN)` pair matches. Spec:
//! `docs/functions/COUNTIFS.md`.

use crate::aggregate::sumifs::{all_match, eval_pairs};
use crate::common::criteria;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    if args.len() % 2 != 0 {
        return Ok(Value::Error(CalcError::Value));
    }
    let first = match criteria::eval_cells(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let crit = match criteria::eval_criterion(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(c) => c,
    };
    let mut pairs = vec![(first, crit)];
    let (rows, cols) = (pairs[0].0.rows(), pairs[0].0.cols());
    match eval_pairs(ctx, args, 2, rows, cols)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(rest) => pairs.extend(rest),
    }

    let len = pairs[0].0.cells().len();
    let count = (0..len).filter(|&i| all_match(&pairs, i)).count();
    Ok(Value::Number(count as f64))
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
                ("B1", "x".into()),
                ("B2", "x".into()),
                ("B3", "y".into()),
            ],
            r#"=COUNTIFS(A1:A3,">1",B1:B3,"x")"#,
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn mismatched_dims_value_error() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", "x".into()),
            ],
            r#"=COUNTIFS(A1:A3,">0",B1:B2,"x")"#,
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn odd_arg_count_errors() {
        assert_eq!(e(&eval(r#"=COUNTIFS(A1:A3,">0",B1:B3)"#)), CalcError::Value);
        assert_eq!(e(&eval("=COUNTIFS(A1:A3)")), CalcError::Value);
    }

    #[test]
    fn band_count_one_range() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            r#"=COUNTIFS(A1:A3,">0",A1:A3,"<3")"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn text_and_numeric_pairs() {
        let v = eval_with(
            &[
                ("A1", "apple".into()),
                ("A2", "APPLE".into()),
                ("A3", "banana".into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            r#"=COUNTIFS(A1:A3,"APPLE",B1:B3,">0")"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn cell_ref_criterion() {
        let v = eval_with(
            &[
                ("A1", 9.0.into()),
                ("A2", 9.0.into()),
                ("A3", 1.0.into()),
                ("D1", 9.0.into()),
            ],
            "=COUNTIFS(A1:A3,D1)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn no_match_gives_zero() {
        let v = eval_with(&[("A1", 1.0.into())], r#"=COUNTIFS(A1:A2,">99")"#);
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn contradictory_pairs_give_zero() {
        let v = eval_with(
            &[("A1", 5.0.into()), ("A2", 6.0.into())],
            r#"=COUNTIFS(A1:A2,">5",A1:A2,"<2")"#,
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn three_pairs() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", "x".into()),
                ("B2", "x".into()),
                ("C1", 5.0.into()),
                ("C2", 5.0.into()),
            ],
            r#"=COUNTIFS(A1:A2,">0",B1:B2,"x",C1:C2,5)"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn error_cells_in_range_skipped() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            r#"=COUNTIFS(A1:A2,">0")"#,
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn error_in_criteria_arg_propagates() {
        assert_eq!(e(&eval("=COUNTIFS(A1:A2,1/0)")), CalcError::DivZero);
    }
}
