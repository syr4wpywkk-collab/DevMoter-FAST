//! `WRAPROWS(vector, wrap_count, [pad_with])` — reshape a vector into
//! `wrap_count` columns, filling across rows. Spec:
//! `docs/functions/WRAPROWS.md`.

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
    // 2-D input (both dims > 1) is not a vector -> `#VALUE!`.
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
    let rows = len.div_ceil(wrap);
    let flat: Vec<Value> = a.cells().to_vec();
    let mut cells = Vec::with_capacity((rows * wrap) as usize);
    for r in 0..rows {
        for c in 0..wrap {
            let i = r * wrap + c;
            cells.push(flat.get(i as usize).cloned().unwrap_or_else(|| pad.clone()));
        }
    }
    match ArrayValue::new(rows, wrap, cells) {
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
    fn row_vector_wraps_across_rows() {
        let (r, c, cells) = arr(&eval("=WRAPROWS({1,2,3,4,5},2)"));
        assert_eq!((r, c), (3, 2));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(2.0),
                Value::Number(3.0),
                Value::Number(4.0),
                Value::Number(5.0),
                Value::Error(CalcError::NA)
            ]
        );
    }

    #[test]
    fn column_vector_wraps() {
        let (r, c, cells) = arr(&eval("=WRAPROWS({1;2;3;4;5;6},3)"));
        assert_eq!((r, c), (2, 3));
        assert_eq!(cells[0], Value::Number(1.0));
        assert_eq!(cells[3], Value::Number(4.0));
    }

    #[test]
    fn pad_with() {
        let (_, _, cells) = arr(&eval("=WRAPROWS({1,2,3,4,5},2,0)"));
        assert_eq!(cells[5], Value::Number(0.0));
    }

    #[test]
    fn zero_and_negative_wrap_count() {
        assert_eq!(e(&eval("=WRAPROWS({1,2},0)")), CalcError::Value);
        assert_eq!(e(&eval("=WRAPROWS({1,2},-1)")), CalcError::Value);
    }

    #[test]
    fn two_dimensional_input_errors() {
        assert_eq!(e(&eval("=WRAPROWS({1,2;3,4},2)")), CalcError::Value);
    }

    #[test]
    fn wrap_count_exceeds_length() {
        let (r, c, cells) = arr(&eval("=WRAPROWS({1,2},5,0)"));
        assert_eq!((r, c), (1, 5));
        assert_eq!(cells[4], Value::Number(0.0));
    }

    #[test]
    fn fractional_wrap_truncates() {
        let (_, c, _) = arr(&eval("=WRAPROWS({1,2,3,4},2.9)"));
        assert_eq!(c, 2);
    }

    #[test]
    fn non_numeric_wrap() {
        assert_eq!(e(&eval(r#"=WRAPROWS({1,2},"x")"#)), CalcError::Value);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=WRAPROWS(1/0,2)")), CalcError::DivZero);
        assert_eq!(e(&eval("=WRAPROWS({1},1/0)")), CalcError::DivZero);
    }

    #[test]
    fn text_pad() {
        let (_, _, cells) = arr(&eval(r#"=WRAPROWS({1,2,3},2,"-")"#));
        assert_eq!(cells[3], Value::Text("-".into()));
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=WRAPROWS({1})")), CalcError::Value);
        assert_eq!(e(&eval("=WRAPROWS({1},1,0,0)")), CalcError::Value);
    }
}
