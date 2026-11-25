//! `INDEX(array, row_num, [column_num])` — value at a position.
//! Spec: `docs/functions/INDEX.md`.
//!
//! Array form only (the multi-area reference form is out of scope).
//! The engine has no reference *value* type: INDEX always returns
//! values, never a usable cell reference — a documented limitation.
//!
//! Index `0`/omitted selects a whole row/column and returns a
//! `Value::Array` (Excel's dynamic-array result). Pre-spill Excel
//! intersected instead — SPEC-OPEN, this engine represents arrays so
//! the array result is returned directly.

use crate::common::lookup::index_to_i64;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let array = match ctx.eval_arg(&args[0])? {
        ArgValue::Range(a) => a,
        ArgValue::Ref(v) => match v {
            Value::Error(e) => return Ok(Value::Error(e)),
            v => ArrayValue::new(1, 1, vec![v]).expect("1x1"),
        },
        ArgValue::Scalar(v) => match v {
            Value::Array(a) => a,
            Value::Error(e) => return Ok(Value::Error(e)),
            _ => return Ok(Value::Error(CalcError::Value)),
        },
    };

    let row = match index_arg(ctx, args.get(1))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(r) => r,
    };
    let col = match args.get(2) {
        Some(expr) => match index_arg(ctx, Some(expr))? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(c) => c,
        },
        None => -1, // sentinel: column_num omitted
    };

    Ok(select(&array, row, col))
}

/// Coerce an index expression (`row_num`/`column_num`); `Missing` or
/// blank behaves as `0` (whole-axis select). Returns `Ok(Err(..))` for
/// coercion failures so the caller can map them to a cell error.
fn index_arg(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
) -> Result<Result<i64, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(0)),
        Some(e) => ctx.eval(e)?,
    };
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    if v.is_blank() {
        return Ok(Ok(0));
    }
    Ok(index_to_i64(&v))
}

fn select(a: &ArrayValue, row: i64, col: i64) -> Value {
    // `INDEX(v, 0)` on any array returns the whole array (dynamic-array
    // semantics); on 2-D, `0` also selects along either axis.
    if row == 0 && (col == -1 || col == 0) {
        return Value::Array(a.clone());
    }
    // 1-D vectors accept a single index across their extent.
    let single_index = col == -1 && (a.rows() == 1 || a.cols() == 1);
    if single_index {
        if row < 1 || row > a.len() as i64 {
            return Value::Error(CalcError::Ref);
        }
        return a.cells()[row as usize - 1].clone();
    }
    let col = if col == -1 { 0 } else { col };
    match (row, col) {
        // Whole-row / whole-column select (dynamic-array semantics).
        (0, 0) => Value::Array(a.clone()),
        (0, c) if c >= 1 && c <= a.cols() as i64 => {
            let cells: Vec<Value> = (0..a.rows())
                .map(|r| a.get(r, c as u32 - 1).unwrap().clone())
                .collect();
            Value::Array(ArrayValue::from_column(cells).expect("column"))
        }
        (r, 0) if r >= 1 && r <= a.rows() as i64 => {
            let cells: Vec<Value> = (0..a.cols())
                .map(|c| a.get(r as u32 - 1, c).unwrap().clone())
                .collect();
            Value::Array(ArrayValue::from_row(cells).expect("row"))
        }
        (r, c) if r >= 1 && c >= 1 && r <= a.rows() as i64 && c <= a.cols() as i64 => {
            a.get(r as u32 - 1, c as u32 - 1).unwrap().clone()
        }
        _ => Value::Error(CalcError::Ref),
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

    fn col3() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", 10.0.into()),
            ("A2", 20.0.into()),
            ("A3", 30.0.into()),
        ]
    }

    fn grid2x2() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", 1.0.into()),
            ("B1", 2.0.into()),
            ("A2", 3.0.into()),
            ("B2", 4.0.into()),
        ]
    }

    #[test]
    fn column_vector_index() {
        assert_eq!(n(&eval_with(&col3(), "=INDEX(A1:A3,2)")), 20.0);
    }

    #[test]
    fn row_vector_index() {
        let v = eval_with(
            &[
                ("A1", 10.0.into()),
                ("B1", 20.0.into()),
                ("C1", 30.0.into()),
            ],
            "=INDEX(A1:C1,2)",
        );
        assert_eq!(n(&v), 20.0);
    }

    #[test]
    fn two_dimensional() {
        assert_eq!(n(&eval_with(&grid2x2(), "=INDEX(A1:B2,2,1)")), 3.0);
        assert_eq!(n(&eval_with(&grid2x2(), "=INDEX(A1:B2,1,2)")), 2.0);
    }

    #[test]
    fn fractional_truncates() {
        assert_eq!(n(&eval_with(&col3(), "=INDEX(A1:A3,1.9)")), 10.0);
    }

    #[test]
    fn numeric_text_index_coerces() {
        assert_eq!(n(&eval_with(&col3(), r#"=INDEX(A1:A3,"2")"#)), 20.0);
    }

    #[test]
    fn out_of_bounds_is_ref() {
        assert_eq!(e(&eval_with(&col3(), "=INDEX(A1:A3,4)")), CalcError::Ref);
        assert_eq!(e(&eval_with(&col3(), "=INDEX(A1:A3,-1)")), CalcError::Ref);
        assert_eq!(
            e(&eval_with(&grid2x2(), "=INDEX(A1:B2,1,3)")),
            CalcError::Ref
        );
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[
                ("A1", 10.0.into()),
                ("A2", Value::Error(CalcError::DivZero)),
                ("A3", 30.0.into()),
            ],
            "=INDEX(A1:A3,2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn blank_cell_returns_blank() {
        assert_eq!(eval_with(&[], "=INDEX(A1:A3,2)"), Value::Blank);
    }

    #[test]
    fn zero_index_returns_column_array() {
        let v = eval_with(&col3(), "=INDEX(A1:A3,0)");
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!((a.rows(), a.cols()), (3, 1));
        assert_eq!(a.get(1, 0), Some(&Value::Number(20.0)));
    }

    #[test]
    fn omitted_column_on_2d_returns_row_array() {
        let v = eval_with(&grid2x2(), "=INDEX(A1:B2,2)");
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!((a.rows(), a.cols()), (1, 2));
        assert_eq!(a.get(0, 0), Some(&Value::Number(3.0)));
        assert_eq!(a.get(0, 1), Some(&Value::Number(4.0)));
    }

    #[test]
    fn single_cell_ref() {
        assert_eq!(n(&eval_with(&col3(), "=INDEX(A2,1)")), 20.0);
    }

    #[test]
    fn bad_index_coercion() {
        assert_eq!(
            e(&eval_with(&col3(), r#"=INDEX(A1:A3,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn scalar_array_arg_is_value_error() {
        assert_eq!(e(&eval("=INDEX(5,1)")), CalcError::Value);
    }
}
