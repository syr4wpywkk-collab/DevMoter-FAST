//! `HSTACK(array1, [array2], ...)` — stacks arrays horizontally.
//! Ragged inputs pad to the tallest row count with `#N/A`.
//! Spec: `docs/functions/HSTACK.md`.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let mut arrays = Vec::with_capacity(args.len());
    for arg in args {
        match coercion::eval_array(ctx, arg)? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(a) => arrays.push(a),
        }
    }
    let height = arrays.iter().map(ArrayValue::rows).max().unwrap_or(1);
    let width: u32 = arrays.iter().map(ArrayValue::cols).sum();
    let na = Value::Error(calc_core::error::CalcError::NA);
    let mut cells = Vec::with_capacity(height as usize * width as usize);
    for r in 0..height {
        for a in &arrays {
            for c in 0..a.cols() {
                cells.push(a.get(r, c).cloned().unwrap_or_else(|| na.clone()));
            }
        }
    }
    match ArrayValue::new(height, width, cells) {
        Ok(v) => Ok(Value::Array(v)),
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
    fn two_equal_arrays() {
        let (r, c, cells) = arr(&eval("=HSTACK({1;2},{3;4})"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[1], Value::Number(3.0));
    }

    #[test]
    fn ragged_pads_na() {
        let (r, c, cells) = arr(&eval("=HSTACK({1;2},{3,4})"));
        assert_eq!((r, c), (2, 3));
        assert_eq!(cells[4], Value::Error(CalcError::NA));
        assert_eq!(cells[5], Value::Error(CalcError::NA));
    }

    #[test]
    fn scalars_become_row() {
        let (r, c, cells) = arr(&eval("=HSTACK(1,2,3)"));
        assert_eq!((r, c), (1, 3));
        assert_eq!(cells[2], Value::Number(3.0));
    }

    #[test]
    fn single_arg_passthrough() {
        let (r, c, _) = arr(&eval("=HSTACK({1,2;3,4})"));
        assert_eq!((r, c), (2, 2));
    }

    #[test]
    fn three_way_ragged() {
        let (r, c, cells) = arr(&eval(r#"=HSTACK({1;2;3},{"a","b"},{7;8})"#));
        assert_eq!((r, c), (3, 4));
        // row layout: r0: 1,a,b,7 ; r1: 2,NA,NA,8 ; r2: 3,NA,NA,NA
        assert_eq!(cells[3], Value::Number(7.0));
        assert_eq!(cells[5], Value::Error(CalcError::NA));
        assert_eq!(cells[7], Value::Number(8.0));
        assert_eq!(cells[11], Value::Error(CalcError::NA));
    }

    #[test]
    fn error_elements_carry_through() {
        let (_, _, cells) = arr(&eval("=HSTACK({#N/A},{1})"));
        assert_eq!(cells[0], Value::Error(CalcError::NA));
    }

    #[test]
    fn ranges_stack() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 2.0.into()), ("C1", 9.0.into())],
            "=HSTACK(A1:B1,C1)",
        );
        let (r, c, cells) = arr(&v);
        assert_eq!((r, c), (1, 3));
        assert_eq!(cells[2], Value::Number(9.0));
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=HSTACK(1/0,{1})")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=HSTACK()")), CalcError::Value);
    }

    #[test]
    fn mixed_scalar_and_array() {
        let (r, c, cells) = arr(&eval("=HSTACK(9,{1,2;3,4})"));
        assert_eq!((r, c), (2, 3));
        assert_eq!(cells[0], Value::Number(9.0));
        assert_eq!(cells[3], Value::Error(CalcError::NA));
    }

    #[test]
    fn hstack_vstack_roundtrip() {
        let (r, c, _) = arr(&eval("=HSTACK(VSTACK(1,2),VSTACK(3,4))"));
        assert_eq!((r, c), (2, 2));
    }
}
