//! `COUNTIF(range, criteria)` — counts cells in `range` matching
//! `criteria`. Spec: `docs/functions/COUNTIF.md`.

use crate::common::criteria;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
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
    let count = range.cells().iter().filter(|c| crit.matches(c)).count();
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
    fn numeric_gt() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("A4", 4.0.into()),
            ],
            r#"=COUNTIF(A1:A4,">1")"#,
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn numeric_arg_equality() {
        let v = eval_with(
            &[("A1", 5.0.into()), ("A2", 6.0.into()), ("A3", 5.0.into())],
            "=COUNTIF(A1:A3,5)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn numeric_text_criterion_matches_numbers() {
        let v = eval_with(
            &[("A1", 5.0.into()), ("A2", 6.0.into()), ("A3", 5.0.into())],
            r#"=COUNTIF(A1:A3,"5")"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn text_equality() {
        let v = eval_with(
            &[("A1", "x".into()), ("A2", "y".into()), ("A3", "x".into())],
            r#"=COUNTIF(A1:A3,"x")"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn text_equality_case_insensitive() {
        let v = eval_with(
            &[
                ("A1", "apple".into()),
                ("A2", "APPLE".into()),
                ("A3", "Apple".into()),
            ],
            r#"=COUNTIF(A1:A3,"APPLE")"#,
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn not_equal() {
        let v = eval_with(
            &[("A1", "x".into()), ("A2", "y".into()), ("A3", "z".into())],
            r#"=COUNTIF(A1:A3,"<>x")"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn wildcard_star() {
        let v = eval_with(
            &[
                ("A1", "apple".into()),
                ("A2", "application".into()),
                ("A3", "banana".into()),
            ],
            r#"=COUNTIF(A1:A3,"app*")"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn wildcard_question_mark() {
        let v = eval_with(
            &[
                ("A1", "abc".into()),
                ("A2", "ab".into()),
                ("A3", "xyz".into()),
            ],
            r#"=COUNTIF(A1:A3,"???")"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn escaped_wildcards() {
        let v = eval_with(
            &[
                ("A1", "a?b".into()),
                ("A2", "axb".into()),
                ("A3", "a??".into()),
            ],
            r#"=COUNTIF(A1:A3,"a~?b")"#,
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn cell_ref_criterion() {
        let v = eval_with(
            &[("A1", 9.0.into()), ("A2", 1.0.into()), ("D1", 9.0.into())],
            "=COUNTIF(A1:A2,D1)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn error_cells_skipped() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero)), ("A2", 1.0.into())],
            r#"=COUNTIF(A1:A2,">0")"#,
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn error_in_criteria_arg_propagates() {
        assert_eq!(e(&eval("=COUNTIF(A1:A2,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn numeric_arg_does_not_match_text() {
        let v = eval_with(
            &[("A1", "5".into()), ("A2", 5.0.into())],
            "=COUNTIF(A1:A2,5)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn arity_errors() {
        assert_eq!(e(&eval("=COUNTIF(A1:A2)")), CalcError::Value);
        assert_eq!(e(&eval("=COUNTIF(A1:A2,1,2)")), CalcError::Value);
    }
}
