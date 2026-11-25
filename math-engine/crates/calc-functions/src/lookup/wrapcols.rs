//! `WRAPCOLS(vector, wrap_count, [pad_with])` — reshape a vector into
//! `wrap_count` rows, filling down columns. Spec:
//! `docs/functions/WRAPCOLS.md`.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    // 2-D input (both dims > 1) is not a vector -> `#VALUE!`
    // (WRAPCOLS.md open question; `#VALUE!` believed correct).
    if a.rows() > 1 && a.cols() > 1 {
        return Ok(Value::Error(CalcError::Value));
    }
    let wrap = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n.trunc() as i64,
    };
    if wrap < 1 {
        return Ok(Value::Error(CalcError::Value));
    }
    let pad = match args.get(2) {
        Some(Expr::Missing) | None => Value::Error(CalcError::NA),
        Some(e) => ctx.eval(e)?,
    };
    let len = a.rows() * a.cols();
    let wrap = wrap as u32;
    let cols = len.div_ceil(wrap);
    let flat: Vec<Value> = a.cells().to_vec();
    let mut cells = Vec::with_capacity((wrap * cols) as usize);
    for r in 0..wrap {
        for c in 0..cols {
            let i = c * wrap + r;
            cells.push(flat.get(i as usize).cloned().unwrap_or_else(|| pad.clone()));
        }
    }
    match ArrayValue::new(wrap, cols, cells) {
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
    fn row_vector_wraps_down_columns() {
        let (r, c, cells) = arr(&eval("=WRAPCOLS({1,2,3,4,5},2)"));
        assert_eq!((r, c), (2, 3));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(3.0),
                Value::Number(5.0),
                Value::Number(2.0),
                Value::Number(4.0),
                Value::Error(CalcError::NA)
            ]
        );
    }

    #[test]
    fn column_vector_wraps() {
        let (r, c, cells) = arr(&eval("=WRAPCOLS({1;2;3;4;5;6},3)"));
        assert_eq!((r, c), (3, 2));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(4.0),
                Value::Number(2.0),
                Value::Number(5.0),
                Value::Number(3.0),
                Value::Number(6.0)
            ]
        );
    }

    #[test]
    fn pad_with() {
        let (_, _, cells) = arr(&eval("=WRAPCOLS({1,2,3,4,5},2,0)"));
        assert_eq!(cells[5], Value::Number(0.0));
    }

    #[test]
    fn zero_and_negative_wrap_count() {
        assert_eq!(e(&eval("=WRAPCOLS({1,2},0)")), CalcError::Value);
        assert_eq!(e(&eval("=WRAPCOLS({1,2},-1)")), CalcError::Value);
    }

    #[test]
    fn two_dimensional_input_errors() {
        assert_eq!(e(&eval("=WRAPCOLS({1,2;3,4},2)")), CalcError::Value);
    }

    #[test]
    fn wrap_count_exceeds_length() {
        let (r, c, cells) = arr(&eval("=WRAPCOLS({1,2},5,0)"));
        assert_eq!((r, c), (5, 1));
        assert_eq!(cells[4], Value::Number(0.0));
    }

    #[test]
    fn fractional_wrap_truncates() {
        let (r, _, _) = arr(&eval("=WRAPCOLS({1,2,3,4},2.9)"));
        assert_eq!(r, 2);
    }

    #[test]
    fn non_numeric_wrap() {
        assert_eq!(e(&eval(r#"=WRAPCOLS({1,2},"x")"#)), CalcError::Value);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=WRAPCOLS(1/0,2)")), CalcError::DivZero);
        assert_eq!(e(&eval("=WRAPCOLS({1},1/0)")), CalcError::DivZero);
    }

    #[test]
    fn range_argument() {
        let v = eval_with(
            &[
                ("A1", Value::Number(1.0)),
                ("A2", Value::Number(2.0)),
                ("A3", Value::Number(3.0)),
            ],
            "=WRAPCOLS(A1:A3,2,0)",
        );
        let (r, c, _) = arr(&v);
        assert_eq!((r, c), (2, 2));
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=WRAPCOLS({1})")), CalcError::Value);
        assert_eq!(e(&eval("=WRAPCOLS({1},1,0,0)")), CalcError::Value);
    }
}
