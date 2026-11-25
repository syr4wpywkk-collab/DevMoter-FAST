//! `TRANSPOSE(array)` — swaps rows and columns of an array or range.
//! Spec: `docs/functions/TRANSPOSE.md`.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let (rows, cols) = (a.rows(), a.cols());
    let mut cells = Vec::with_capacity(a.len());
    for c in 0..cols {
        for r in 0..rows {
            cells.push(a.get(r, c).expect("in bounds").clone());
        }
    }
    match ArrayValue::new(cols, rows, cells) {
        Ok(t) => Ok(Value::Array(t)),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn arr(v: &Value) -> (u32, u32, Vec<Value>) {
        match v {
            Value::Array(a) => (a.rows(), a.cols(), a.cells().to_vec()),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn square() {
        let (r, c, cells) = arr(&eval("=TRANSPOSE({1,2;3,4})"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(3.0),
                Value::Number(2.0),
                Value::Number(4.0)
            ]
        );
    }

    #[test]
    fn column_to_row() {
        let (r, c, _) = arr(&eval("=TRANSPOSE({1;2;3})"));
        assert_eq!((r, c), (1, 3));
    }

    #[test]
    fn row_to_column() {
        let (r, c, _) = arr(&eval("=TRANSPOSE({1,2,3})"));
        assert_eq!((r, c), (3, 1));
    }

    #[test]
    fn range_input() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", 3.0.into()),
                ("B2", 4.0.into()),
            ],
            "=TRANSPOSE(A1:B2)",
        );
        let (r, c, cells) = arr(&v);
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[1], Value::Number(2.0));
    }

    #[test]
    fn blanks_survive() {
        let (_, _, cells) = arr(&eval("=TRANSPOSE(A1:B1)"));
        assert_eq!(cells, vec![Value::Blank, Value::Blank]);
    }

    #[test]
    fn error_elements_stay_elements() {
        let (_, _, cells) = arr(&eval("=TRANSPOSE({1,#N/A;3,4})"));
        assert_eq!(cells[2], Value::Error(CalcError::NA));
    }

    #[test]
    fn scalar_wraps_to_1x1() {
        let (r, c, cells) = arr(&eval("=TRANSPOSE(7)"));
        assert_eq!((r, c), (1, 1));
        assert_eq!(cells, vec![Value::Number(7.0)]);
    }

    #[test]
    fn text_and_bool_elements() {
        let (_, _, cells) = arr(&eval(r#"=TRANSPOSE({"a",TRUE})"#));
        assert_eq!(cells[0], Value::Text("a".to_string()));
        assert_eq!(cells[1], Value::Boolean(true));
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=TRANSPOSE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=TRANSPOSE()")), CalcError::Value);
        assert_eq!(e(&eval("=TRANSPOSE({1},{2})")), CalcError::Value);
    }

    #[test]
    fn double_transpose_is_identity() {
        let (_, _, cells) = arr(&eval("=TRANSPOSE(TRANSPOSE({1,2;3,4}))"));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(2.0),
                Value::Number(3.0),
                Value::Number(4.0)
            ]
        );
    }
}
