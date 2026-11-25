//! `HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])`
//! — horizontal mirror of `VLOOKUP`: searches the first row, returns
//! from `row_index_num`. Spec: `docs/functions/HLOOKUP.md`.
//!
//! Shares every semantic decision with `VLOOKUP` via
//! [`crate::common::lookup`].

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
    let table = match ctx.eval_arg(&args[1])? {
        ArgValue::Range(a) | ArgValue::Scalar(Value::Array(a)) => a,
        ArgValue::Scalar(Value::Error(e)) | ArgValue::Ref(Value::Error(e)) => {
            return Ok(Value::Error(e));
        }
        ArgValue::Ref(v) => ArrayValue::new(1, 1, vec![v]).expect("1x1"),
        ArgValue::Scalar(_) => return Ok(Value::Error(CalcError::Value)),
    };
    let row = match ctx.eval(&args[2])? {
        v if v.is_error() => return Ok(v),
        v => match lookup::index_to_i64(&v) {
            Ok(r) if r < 1 => return Ok(Value::Error(CalcError::Value)),
            Ok(r) if r > table.rows() as i64 => return Ok(Value::Error(CalcError::Ref)),
            Ok(r) => r as u32,
            Err(e) => return Ok(Value::Error(e)),
        },
    };
    let exact = match args.get(3) {
        None | Some(Expr::Missing) => false,
        Some(e) => match ctx.eval(e)?.to_boolean() {
            Ok(b) => !b,
            Err(err) => return Ok(Value::Error(err)),
        },
    };

    let keys: Vec<Value> = (0..table.cols())
        .map(|c| table.get(0, c).unwrap().clone())
        .collect();
    let pos = if exact {
        lookup::exact_position(&keys, &needle, true, false)
    } else {
        lookup::approx_asc(&keys, &needle)
    };
    match pos {
        Some(c) => Ok(table.get(row - 1, c as u32).unwrap().clone()),
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

    fn table() -> Vec<(&'static str, Value)> {
        // Header row + data row, laid out horizontally.
        vec![
            ("A1", "apple".into()),
            ("B1", "banana".into()),
            ("C1", "cherry".into()),
            ("A2", 10.0.into()),
            ("B2", 20.0.into()),
            ("C2", 30.0.into()),
        ]
    }

    #[test]
    fn exact_match() {
        assert_eq!(
            n(&eval_with(&table(), r#"=HLOOKUP("banana",A1:C2,2,FALSE)"#)),
            20.0
        );
    }

    #[test]
    fn exact_case_insensitive() {
        assert_eq!(
            n(&eval_with(&table(), r#"=HLOOKUP("BANANA",A1:C2,2,0)"#)),
            20.0
        );
    }

    #[test]
    fn exact_wildcard() {
        assert_eq!(
            n(&eval_with(&table(), r#"=HLOOKUP("ch?rry",A1:C2,2,FALSE)"#)),
            30.0
        );
    }

    #[test]
    fn not_found() {
        assert_eq!(
            e(&eval_with(&table(), r#"=HLOOKUP("fig",A1:C2,2,FALSE)"#)),
            CalcError::NA
        );
    }

    #[test]
    fn approx_default_true() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("B1", 3.0.into()),
                ("C1", 5.0.into()),
                ("A2", 10.0.into()),
                ("B2", 30.0.into()),
                ("C2", 50.0.into()),
            ],
            "=HLOOKUP(4,A1:C2,2)",
        );
        assert_eq!(n(&v), 30.0);
    }

    #[test]
    fn approx_below_all_na() {
        assert_eq!(
            e(&eval_with(&table(), r#"=HLOOKUP(0,A1:C2,2,TRUE)"#)),
            CalcError::NA
        );
    }

    #[test]
    fn row_index_zero_value() {
        assert_eq!(
            e(&eval_with(&table(), r#"=HLOOKUP("banana",A1:C2,0)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn row_index_too_deep_ref() {
        assert_eq!(
            e(&eval_with(&table(), r#"=HLOOKUP("banana",A1:C2,3)"#)),
            CalcError::Ref
        );
    }

    #[test]
    fn error_needle_propagates() {
        assert_eq!(
            e(&eval_with(&table(), "=HLOOKUP(1/0,A1:C2,2)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn single_column_table() {
        let v = eval_with(
            &[("A1", "k".into()), ("A2", 9.0.into())],
            r#"=HLOOKUP("k",A1:A2,2,FALSE)"#,
        );
        assert_eq!(n(&v), 9.0);
    }

    #[test]
    fn header_row_return() {
        assert_eq!(
            eval_with(&table(), r#"=HLOOKUP("banana",A1:C2,1,FALSE)"#),
            Value::Text("banana".into())
        );
    }
}
