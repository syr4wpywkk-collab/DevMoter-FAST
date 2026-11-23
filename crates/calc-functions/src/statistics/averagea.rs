//! `AVERAGEA(value1, [value2], ...)` — mean counting text and logicals as
//! numbers (`TRUE` -> 1, `FALSE` -> 0, text -> 0). Spec:
//! `docs/functions/AVERAGEA.md`.
//!
//! Differs from `AVERAGE` inside ranges: numbers count at face value,
//! booleans as `1`/`0`, text (including `""`) as `0`; truly blank cells
//! are skipped. Direct scalars follow the usual `to_number` coercion
//! (numeric text parses; unparsable text -> `#VALUE!`) except that a
//! scalar blank is skipped like an empty cell.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let flat = coercion::flatten_args(ctx, args)?;
    let (mut sum, mut count) = (0.0, 0usize);
    for (v, ranged) in flat {
        if let Some(e) = v.error() {
            return Ok(Value::Error(e));
        }
        if ranged {
            match v {
                Value::Number(n) => {
                    sum += n;
                    count += 1;
                }
                Value::Boolean(b) => {
                    sum += if b { 1.0 } else { 0.0 };
                    count += 1;
                }
                // Any text (including "") counts as 0; blanks skip.
                Value::Text(_) => count += 1,
                _ => {}
            }
        } else {
            // Direct scalar: Blank is skipped (like an empty cell);
            // everything else coerces via to_number (booleans -> 1/0,
            // numeric text parses, other text -> #VALUE!).
            if v.is_blank() {
                continue;
            }
            match v.to_number() {
                Ok(n) => {
                    sum += n;
                    count += 1;
                }
                Err(e) => return Ok(Value::Error(e)),
            }
        }
    }
    if count == 0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(sum / count as f64))
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
    fn plain_numbers() {
        assert_eq!(n(&eval("=AVERAGEA(1,2,3)")), 2.0);
    }

    #[test]
    fn range_counts_text_and_bool() {
        // {10, "text", TRUE, blank} -> (10+0+1)/3.
        let v = eval_with(
            &[
                ("A1", 10.0.into()),
                ("A2", "text".into()),
                ("A3", Value::Boolean(true)),
            ],
            "=AVERAGEA(A1:A4)",
        );
        assert_eq!(n(&v), 11.0 / 3.0);
    }

    #[test]
    fn direct_booleans() {
        assert_eq!(n(&eval("=AVERAGEA(TRUE,FALSE)")), 0.5);
    }

    #[test]
    fn empty_string_counts_zero() {
        let v = eval_with(&[("A1", "".into()), ("A2", 2.0.into())], "=AVERAGEA(A1:A2)");
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn all_blank_div_zero() {
        assert_eq!(e(&eval("=AVERAGEA(A1:A2)")), CalcError::DivZero);
    }

    #[test]
    fn scalar_blank_skipped() {
        // A blank literal/ref scalar does not count; only {6} remains.
        assert_eq!(n(&eval("=AVERAGEA(A1,6)")), 6.0);
    }

    #[test]
    fn boolean_cell_zero_counts() {
        let v = eval_with(
            &[("A1", Value::Boolean(false)), ("A2", 4.0.into())],
            "=AVERAGEA(A1:A2)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn direct_numeric_text() {
        assert_eq!(n(&eval(r#"=AVERAGEA("2",4)"#)), 3.0);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=AVERAGEA("abc",2)"#)), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=AVERAGEA(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn array_literal_counts_text() {
        // {1, "x", TRUE} -> (1+0+1)/3.
        let v = n(&eval(r#"=AVERAGEA({1,"x",TRUE})"#));
        assert!((v - 2.0 / 3.0).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn no_args_arity_error() {
        assert!(matches!(eval("=AVERAGEA()"), Value::Error(_)));
    }
}
