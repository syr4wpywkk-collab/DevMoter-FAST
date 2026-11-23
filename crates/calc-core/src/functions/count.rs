//! `COUNT(value1, [value2], ...)` — counts numeric values.
//! Spec: `docs/functions/COUNT.md`.

use crate::ast::Expr;
use crate::eval::{EvalContext, EvalError};
use crate::functions::{MAX_ARGS, check_arity, helpers};
use crate::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let flat = helpers::flatten_args(ctx, args)?;
    let mut count = 0u64;
    for (v, ranged) in flat {
        if ranged {
            // Range cells: numbers only; error cells are skipped
            // (SPEC-OPEN: confirm Excel skips rather than propagates).
            if matches!(v, Value::Number(_)) {
                count += 1;
            }
        } else {
            match &v {
                // Errors produced inside an argument expression propagate.
                Value::Error(e) => return Ok(Value::Error(*e)),
                Value::Number(_) | Value::Boolean(_) => count += 1,
                // Numeric-looking text counts; other text does not error.
                Value::Text(s) if helpers::text_is_number(s) => count += 1,
                _ => {}
            }
        }
    }
    Ok(Value::Number(count as f64))
}

#[cfg(test)]
mod tests {
    use super::super::helpers::test_support::*;
    use crate::{CalcError, Value};

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
    fn counts_numbers_in_range() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", "x".into()),
                ("A4", 3.0.into()),
            ],
            "=COUNT(A1:A4)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn direct_numbers() {
        assert_eq!(n(&eval("=COUNT(1,2,3)")), 3.0);
    }

    #[test]
    fn range_ignores_numeric_text() {
        let v = eval_with(&[("A1", "1".into()), ("A2", "2".into())], "=COUNT(A1:A3)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn direct_numeric_text_counts() {
        assert_eq!(n(&eval(r#"=COUNT("5",2)"#)), 2.0);
    }

    #[test]
    fn ignores_blanks() {
        let v = eval_with(&[("A2", "x".into())], "=COUNT(A1:A3)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn range_ignores_booleans() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", 2.0.into()),
                ("A3", Value::Boolean(false)),
            ],
            "=COUNT(A1:A3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn direct_booleans_count() {
        assert_eq!(n(&eval("=COUNT(TRUE,2)")), 2.0);
    }

    #[test]
    fn direct_nonnumeric_text_not_counted() {
        assert_eq!(n(&eval(r#"=COUNT("x",2)"#)), 1.0);
    }

    #[test]
    fn mixed_ranges() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "x".into()),
                ("B1", 2.0.into()),
                ("B2", 3.0.into()),
            ],
            "=COUNT(A1:A2,B1:B2)",
        );
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn counts_zero() {
        assert_eq!(n(&eval("=COUNT(0)")), 1.0);
    }

    #[test]
    fn counts_various_numbers() {
        assert_eq!(n(&eval("=COUNT(-1,1.5,1e3)")), 3.0);
    }

    #[test]
    fn error_in_argument_propagates() {
        assert_eq!(e(&eval("=COUNT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn error_cell_in_range_skipped() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=COUNT(A1:A2)",
        );
        assert_eq!(n(&v), 1.0);
    }
}
