//! `COUNTBLANK(range)` — count of empty cells and cells containing
//! `""` (empty text). Spec: `docs/functions/COUNTBLANK.md`.
//!
//! Counts `Value::Blank` and `Text("")`; numbers (incl. `0`), booleans,
//! errors and non-empty text (incl. `" "`) do not count. A cell/array
//! reference evaluates through the same matrix path as the criteria
//! helpers, so a bare literal is counted as a 1x1 matrix (SPEC-OPEN —
//! Excel requires a range and the error kind for a literal is not
//! pinned).

use crate::common::criteria;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

fn is_blankish(v: &Value) -> bool {
    matches!(v, Value::Blank) || matches!(v, Value::Text(s) if s.is_empty())
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let cells = match criteria::eval_cells(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let count = cells.cells().iter().filter(|v| is_blankish(v)).count();
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

    #[test]
    fn counts_empty_cells_in_range() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A3", "x".into())],
            "=COUNTBLANK(A1:B3)",
        );
        // A2, B1..B3 empty -> 4.
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn counts_empty_text() {
        let v = eval_with(
            &[("A1", "".into()), ("A2", 0.0.into())],
            "=COUNTBLANK(A1:A3)",
        );
        // "" and empty A3 -> 2.
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn does_not_count_zero() {
        let v = eval_with(&[("A1", 0.0.into())], "=COUNTBLANK(A1:A1)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn does_not_count_space_text() {
        let v = eval_with(&[("A1", " ".into())], "=COUNTBLANK(A1:A1)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn does_not_count_booleans_or_errors() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", Value::Error(CalcError::NA)),
            ],
            "=COUNTBLANK(A1:A3)",
        );
        // Only A3 (empty) counts.
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn single_numeric_cell() {
        let v = eval_with(&[("A1", 7.0.into())], "=COUNTBLANK(A1)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn mixed_spec_example() {
        // {0, " ", ""}: only "" counts.
        let v = eval_with(
            &[("A1", 0.0.into()), ("A2", " ".into()), ("A3", "".into())],
            "=COUNTBLANK(A1:A3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn empty_string_formula_result_counts() {
        let v = eval_with(&[("A1", 5.0.into())], r#"=COUNTBLANK(B1)"#);
        // B1 unset -> blank -> 1; also confirms "" results via second case below.
        assert_eq!(n(&v), 1.0);
        let v = eval_with(
            &[("A1", 5.0.into())],
            r#"=COUNTBLANK(C1)+COUNTBLANK(IF(TRUE,"",1))"#,
        );
        // C1 blank (1) + IF(TRUE...) returns "" -> 1 more.
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn all_blank_range() {
        assert_eq!(n(&eval("=COUNTBLANK(Z1:Z5)")), 5.0);
    }

    #[test]
    fn error_cell_does_not_count_or_propagate() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::DivZero))],
            "=COUNTBLANK(A1:A2)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn wrong_arity() {
        assert!(matches!(eval("=COUNTBLANK()"), Value::Error(_)));
        assert!(matches!(eval("=COUNTBLANK(A1,A2)"), Value::Error(_)));
    }
}
