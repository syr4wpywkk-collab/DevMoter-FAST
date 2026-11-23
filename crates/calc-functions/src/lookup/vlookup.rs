//! `VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])`
//! — search the first column of a table, return a value from the
//! matched row. Spec: `docs/functions/VLOOKUP.md`.
//!
//! Exact mode (`range_lookup` FALSE) is a linear scan with wildcard
//! support for text needles. Approximate mode (default) binary-searches
//! the first column as if ascending — deterministic but unspecified on
//! unsorted input (SPEC-OPEN vs Excel's binary-search quirks).

use crate::common::lookup;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 4) {
        return Ok(Value::Error(e));
    }
    let needle = ctx.eval(&args[0])?;
    if let Some(e) = needle.error() {
        return Ok(Value::Error(e));
    }
    let table = match table(ctx, &args[1])? {
        Ok(t) => t,
        Err(v) => return Ok(v),
    };
    let col = match ctx.eval(&args[2])? {
        v if v.is_error() => return Ok(v),
        v => match lookup::index_to_i64(&v) {
            Ok(c) if c < 1 => return Ok(Value::Error(CalcError::Value)),
            Ok(c) if c > table.cols() as i64 => return Ok(Value::Error(CalcError::Ref)),
            Ok(c) => c as u32,
            Err(e) => return Ok(Value::Error(e)),
        },
    };
    let exact = match range_lookup(ctx, args.get(3))? {
        Ok(b) => !b,
        Err(e) => return Ok(Value::Error(e)),
    };

    let keys: Vec<Value> = (0..table.rows())
        .map(|r| table.get(r, 0).unwrap().clone())
        .collect();
    let pos = if exact {
        lookup::exact_position(&keys, &needle, true, false)
    } else {
        lookup::approx_asc(&keys, &needle)
    };
    match pos {
        Some(r) => Ok(table.get(r as u32, col - 1).unwrap().clone()),
        None => Ok(lookup::not_found()),
    }
}

/// Materialize `table_array` into an [`ArrayValue`]; a single cell ref
/// is a 1x1 table, other scalars are `#VALUE!`.
fn table(ctx: &mut EvalContext<'_>, expr: &Expr) -> Result<Result<ArrayValue, Value>, EvalError> {
    match ctx.eval_arg(expr)? {
        ArgValue::Range(a) | ArgValue::Scalar(Value::Array(a)) => Ok(Ok(a)),
        ArgValue::Scalar(Value::Error(e)) | ArgValue::Ref(Value::Error(e)) => {
            Ok(Err(Value::Error(e)))
        }
        ArgValue::Ref(v) => Ok(Ok(ArrayValue::new(1, 1, vec![v]).expect("1x1"))),
        ArgValue::Scalar(_) => Ok(Err(Value::Error(CalcError::Value))),
    }
}

/// `range_lookup`: omitted/blank -> TRUE (approximate); otherwise
/// boolean coercion (`0`/nonzero, TRUE/FALSE text).
fn range_lookup(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
) -> Result<Result<bool, CalcError>, EvalError> {
    match expr {
        None | Some(Expr::Missing) => Ok(Ok(true)),
        Some(e) => {
            let v = ctx.eval(e)?;
            Ok(v.to_boolean())
        }
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

    fn table() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", "apple".into()),
            ("A2", "banana".into()),
            ("A3", "cherry".into()),
            ("B1", 10.0.into()),
            ("B2", 20.0.into()),
            ("B3", 30.0.into()),
        ]
    }

    #[test]
    fn exact_match() {
        assert_eq!(
            n(&eval_with(&table(), r#"=VLOOKUP("banana",A1:B3,2,FALSE)"#)),
            20.0
        );
    }

    #[test]
    fn exact_case_insensitive() {
        assert_eq!(
            n(&eval_with(&table(), r#"=VLOOKUP("BANANA",A1:B3,2,0)"#)),
            20.0
        );
    }

    #[test]
    fn exact_wildcard() {
        assert_eq!(
            n(&eval_with(&table(), r#"=VLOOKUP("ch*",A1:B3,2,FALSE)"#)),
            30.0
        );
    }

    #[test]
    fn not_found() {
        assert_eq!(
            e(&eval_with(&table(), r#"=VLOOKUP("fig",A1:B3,2,FALSE)"#)),
            CalcError::NA
        );
    }

    #[test]
    fn approx_default_true() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 3.0.into()),
                ("A3", 5.0.into()),
                ("B1", 10.0.into()),
                ("B2", 30.0.into()),
                ("B3", 50.0.into()),
            ],
            "=VLOOKUP(4,A1:B3,2)",
        );
        assert_eq!(n(&v), 30.0); // largest key <= 4 is 3
    }

    #[test]
    fn approx_below_all_na() {
        let v = eval_with(&table(), r#"=VLOOKUP("0",A1:B3,2,TRUE)"#);
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn range_lookup_numeric_coercion() {
        assert_eq!(
            n(&eval_with(&table(), r#"=VLOOKUP("banana",A1:B3,2,0)"#)),
            20.0
        );
    }

    #[test]
    fn col_index_zero_value() {
        assert_eq!(
            e(&eval_with(&table(), r#"=VLOOKUP("banana",A1:B3,0)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn col_index_too_wide_ref() {
        assert_eq!(
            e(&eval_with(&table(), r#"=VLOOKUP("banana",A1:B3,3)"#)),
            CalcError::Ref
        );
    }

    #[test]
    fn col_index_truncates() {
        // 1.9 truncates to column 1 -> returns the key itself.
        assert_eq!(
            eval_with(&table(), r#"=VLOOKUP("banana",A1:B3,1.9,FALSE)"#),
            Value::Text("banana".into())
        );
    }

    #[test]
    fn error_needle_propagates() {
        assert_eq!(
            e(&eval_with(&table(), "=VLOOKUP(1/0,A1:B3,2)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn first_col_return() {
        assert_eq!(
            eval_with(&table(), r#"=VLOOKUP("banana",A1:B3,1,FALSE)"#),
            Value::Text("banana".into())
        );
    }

    #[test]
    fn single_row_table() {
        let v = eval_with(
            &[("A1", "k".into()), ("B1", 9.0.into())],
            r#"=VLOOKUP("k",A1:B1,2,FALSE)"#,
        );
        assert_eq!(n(&v), 9.0);
    }
}
