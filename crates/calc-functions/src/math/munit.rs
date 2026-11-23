//! `MUNIT(dimension)` — n x n identity matrix, returned as an array.
//! Spec: `docs/functions/MUNIT.md`.
//!
//! `dimension` is truncated toward zero (spec's stated reading;
//! the alternative `#VALUE!` on non-integer input is SPEC-OPEN in the
//! spec doc). `dimension <= 0` is `#VALUE!`; `n * n` beyond the engine
//! array-size cap is `#VALUE!` via `ArrayValue`.

use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let d = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let n = d.trunc();
    if n <= 0.0 || n > u32::MAX as f64 {
        return Ok(Value::Error(calc_core::CalcError::Value));
    }
    let n = n as u32;
    let size = n as usize;
    let Some(len) = size.checked_mul(size) else {
        return Ok(Value::Error(calc_core::CalcError::Value));
    };
    // `ArrayValue::new` enforces MAX_ARRAY_CELLS -> #VALUE! beyond the cap.
    if len > calc_core::array::MAX_ARRAY_CELLS {
        return Ok(Value::Error(calc_core::CalcError::Value));
    }
    let mut cells = vec![Value::Number(0.0); len];
    for i in 0..size {
        cells[i * size + i] = Value::Number(1.0);
    }
    match ArrayValue::new(n, n, cells) {
        Ok(a) => Ok(Value::Array(a)),
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
    fn spec_3x3() {
        let (r, c, cells) = arr(&eval("=MUNIT(3)"));
        assert_eq!((r, c), (3, 3));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(0.0),
                Value::Number(0.0),
                Value::Number(0.0),
                Value::Number(1.0),
                Value::Number(0.0),
                Value::Number(0.0),
                Value::Number(0.0),
                Value::Number(1.0),
            ]
        );
    }

    #[test]
    fn spec_1x1() {
        let (r, c, cells) = arr(&eval("=MUNIT(1)"));
        assert_eq!((r, c), (1, 1));
        assert_eq!(cells, vec![Value::Number(1.0)]);
    }

    #[test]
    fn spec_2x2() {
        let (r, c, cells) = arr(&eval("=MUNIT(2)"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(0.0),
                Value::Number(0.0),
                Value::Number(1.0),
            ]
        );
    }

    #[test]
    fn non_integer_truncates() {
        // SPEC-OPEN in spec doc; implemented as truncation.
        let (r, c, _) = arr(&eval("=MUNIT(2.7)"));
        assert_eq!((r, c), (2, 2));
        let (r, c, _) = arr(&eval("=MUNIT(3.99)"));
        assert_eq!((r, c), (3, 3));
    }

    #[test]
    fn zero_and_negative() {
        assert_eq!(e(&eval("=MUNIT(0)")), CalcError::Value);
        assert_eq!(e(&eval("=MUNIT(-3)")), CalcError::Value);
        assert_eq!(e(&eval("=MUNIT(-0.5)")), CalcError::Value);
    }

    #[test]
    fn text_coerces() {
        let (r, c, _) = arr(&eval(r#"=MUNIT("2")"#));
        assert_eq!((r, c), (2, 2));
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=MUNIT("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        let (r, c, _) = arr(&eval("=MUNIT(TRUE)"));
        assert_eq!((r, c), (1, 1));
    }

    #[test]
    fn blank_ref_coerces_zero() {
        assert_eq!(e(&eval("=MUNIT(A1)")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MUNIT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn cell_ref() {
        let (r, c, _) = arr(&eval_with(&[("A1", 4.0.into())], "=MUNIT(A1)"));
        assert_eq!((r, c), (4, 4));
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MUNIT()")), CalcError::Value);
        assert_eq!(e(&eval("=MUNIT(2,2)")), CalcError::Value);
    }
}
