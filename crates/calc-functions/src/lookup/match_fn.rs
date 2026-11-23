//! `MATCH(lookup_value, lookup_array, [match_type])` — 1-based position
//! of a value in a one-dimensional vector. Spec: `docs/functions/MATCH.md`.
//!
//! `match_type` ±1 binary-searches the vector *as if sorted* (Excel
//! semantics); results on unsorted input are deterministic but
//! unspecified (SPEC-OPEN — not guaranteed identical to Excel's own
//! binary-search quirks). `match_type` 0 is a linear scan with
//! wildcard support for text needles.

use crate::common::lookup;
use calc_core::ast::Expr;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let needle = ctx.eval(&args[0])?;
    if let Some(e) = needle.error() {
        return Ok(Value::Error(e));
    }

    let cells: Vec<Value> = match ctx.eval_arg(&args[1])? {
        // A 1-D range/array is searched; 2-D is #N/A in Excel.
        ArgValue::Range(a) if a.rows() == 1 || a.cols() == 1 => a.into_iter().collect(),
        ArgValue::Range(_) => return Ok(lookup::not_found()),
        ArgValue::Scalar(Value::Array(a)) if a.rows() == 1 || a.cols() == 1 => {
            a.into_iter().collect()
        }
        ArgValue::Scalar(Value::Array(_)) => return Ok(lookup::not_found()),
        ArgValue::Scalar(Value::Error(e)) | ArgValue::Ref(Value::Error(e)) => {
            return Ok(Value::Error(e));
        }
        // A single cell or scalar is a 1-element lookup vector.
        ArgValue::Ref(v) | ArgValue::Scalar(v) => vec![v],
    };

    let match_type = match args.get(2) {
        None | Some(Expr::Missing) => 1,
        Some(expr) => {
            let v = ctx.eval(expr)?;
            if let Some(e) = v.error() {
                return Ok(Value::Error(e));
            }
            if v.is_blank() {
                1
            } else {
                match lookup::index_to_i64(&v) {
                    Ok(1) => 1,
                    Ok(0) => 0,
                    Ok(-1) => -1,
                    _ => return Ok(lookup::not_found()),
                }
            }
        }
    };

    let pos = match match_type {
        // Exact match: wildcards honored for text needles (Excel rule).
        0 => lookup::exact_position(&cells, &needle, true, false),
        1 => lookup::approx_asc(&cells, &needle),
        _ => lookup::approx_desc(&cells, &needle),
    };
    match pos {
        Some(i) => Ok(Value::Number(i as f64 + 1.0)),
        None => Ok(lookup::not_found()),
    }
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

    fn asc() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", 1.0.into()),
            ("A2", 2.0.into()),
            ("A3", 3.0.into()),
            ("A4", 4.0.into()),
        ]
    }

    #[test]
    fn exact_numeric() {
        assert_eq!(n(&eval_with(&asc(), "=MATCH(2,A1:A4,0)")), 2.0);
    }

    #[test]
    fn exact_text_case_insensitive() {
        let v = eval_with(
            &[("A1", "banana".into()), ("A2", "apple".into())],
            r#"=MATCH("APPLE",A1:A2,0)"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn exact_wildcard() {
        let v = eval_with(
            &[
                ("A1", "zzz".into()),
                ("A2", "apple".into()),
                ("A3", "apex".into()),
            ],
            r#"=MATCH("ap*",A1:A3,0)"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn exact_type_strict() {
        // text "1" does not match number cells.
        assert_eq!(
            e(&eval_with(&asc(), r#"=MATCH("1",A1:A4,0)"#)),
            CalcError::NA
        );
    }

    #[test]
    fn exact_no_match_na() {
        assert_eq!(e(&eval_with(&asc(), "=MATCH(9,A1:A4,0)")), CalcError::NA);
    }

    #[test]
    fn default_match_type_is_1() {
        assert_eq!(n(&eval_with(&asc(), "=MATCH(4,A1:A4)")), 4.0);
    }

    #[test]
    fn approx_ascending() {
        assert_eq!(n(&eval_with(&asc(), "=MATCH(2.5,A1:A4,1)")), 2.0);
        assert_eq!(n(&eval_with(&asc(), "=MATCH(9,A1:A4,1)")), 4.0);
    }

    #[test]
    fn approx_ascending_below_all() {
        assert_eq!(e(&eval_with(&asc(), "=MATCH(0,A1:A4,1)")), CalcError::NA);
    }

    #[test]
    fn approx_descending() {
        let v = eval_with(
            &[
                ("A1", 8.0.into()),
                ("A2", 6.0.into()),
                ("A3", 4.0.into()),
                ("A4", 2.0.into()),
            ],
            "=MATCH(5,A1:A4,-1)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn two_d_array_is_na() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("B1", 2.0.into()),
                ("A2", 3.0.into()),
                ("B2", 4.0.into()),
            ],
            "=MATCH(2,A1:B2,0)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn first_duplicate_wins() {
        let v = eval_with(
            &[
                ("A1", 4.0.into()),
                ("A2", 3.0.into()),
                ("A3", 3.0.into()),
                ("A4", 1.0.into()),
            ],
            "=MATCH(3,A1:A4,0)",
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn row_vector() {
        let v = eval_with(
            &[("A1", "x".into()), ("B1", "y".into())],
            r#"=MATCH("y",A1:B1,0)"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn invalid_match_type() {
        assert_eq!(e(&eval_with(&asc(), "=MATCH(2,A1:A4,7)")), CalcError::NA);
    }

    #[test]
    fn error_needle_propagates() {
        assert_eq!(
            e(&eval_with(&asc(), "=MATCH(1/0,A1:A4,0)")),
            CalcError::DivZero
        );
    }
}
