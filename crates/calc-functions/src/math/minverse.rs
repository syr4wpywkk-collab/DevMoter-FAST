//! `MINVERSE(array)` — multiplicative inverse of a square numeric
//! matrix, returned as an n x n array (spills where spill exists).
//! Spec: `docs/functions/MINVERSE.md`.
//!
//! Non-square input is `#VALUE!`; blank/text/boolean cells are
//! `#VALUE!`; error cells propagate; singular matrices (pivot below a
//! `1e-12`-relative threshold — SPEC-OPEN in the spec doc) are `#NUM!`.

use super::matrix;
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
    let (rows, cols, m) = match matrix::to_f64_matrix(&a) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };
    if rows != cols {
        return Ok(Value::Error(calc_core::CalcError::Value));
    }
    let inv = match matrix::inverse(rows, &m) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(inv) => inv,
    };
    match ArrayValue::new(
        rows as u32,
        cols as u32,
        inv.into_iter().map(Value::Number).collect(),
    ) {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn arr(v: &Value) -> (u32, u32, Vec<f64>) {
        match v {
            Value::Array(a) => (
                a.rows(),
                a.cols(),
                a.iter()
                    .map(|v| match v {
                        Value::Number(n) => *n,
                        o => panic!("expected number cell, got {o:?}"),
                    })
                    .collect(),
            ),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    fn assert_arr(v: &Value, rows: u32, cols: u32, want: &[f64]) {
        let (r, c, got) = arr(v);
        assert_eq!((r, c), (rows, cols));
        assert_eq!(got.len(), want.len());
        for (g, w) in got.iter().zip(want) {
            assert!((g - w).abs() < 1e-12, "got {g}, want {w}");
        }
    }

    #[test]
    fn spec_2x2() {
        assert_arr(&eval("=MINVERSE({4,-1;2,0})"), 2, 2, &[0.0, 0.5, -1.0, 2.0]);
    }

    #[test]
    fn spec_1x1() {
        assert_arr(&eval("=MINVERSE({2})"), 1, 1, &[0.5]);
    }

    #[test]
    fn scalar_wraps_1x1() {
        assert_arr(&eval("=MINVERSE(4)"), 1, 1, &[0.25]);
    }

    #[test]
    fn spec_3x3() {
        // Verified: product with the input is the identity.
        let v = eval("=MINVERSE({1,2,1;3,4,-1;0,2,3})");
        assert_arr(
            &v,
            3,
            3,
            &[7.0, -2.0, -3.0, -4.5, 1.5, 2.0, 3.0, -1.0, -1.0],
        );
    }

    #[test]
    fn inverse_times_original_is_identity() {
        // MMULT(A, MINVERSE(A)) = I — cross-check through the engine.
        let v = eval("=MMULT({4,-1;2,0},MINVERSE({4,-1;2,0}))");
        assert_arr(&v, 2, 2, &[1.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn range_input() {
        let v = eval_with(
            &[
                ("A1", 4.0.into()),
                ("B1", (-1.0).into()),
                ("A2", 2.0.into()),
                ("B2", 0.0.into()),
            ],
            "=MINVERSE(A1:B2)",
        );
        assert_arr(&v, 2, 2, &[0.0, 0.5, -1.0, 2.0]);
    }

    #[test]
    fn identity_is_own_inverse() {
        assert_arr(
            &eval("=MINVERSE({1,0,0;0,1,0;0,0,1})"),
            3,
            3,
            &[1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        );
    }

    #[test]
    fn singular_num_error() {
        assert_eq!(e(&eval("=MINVERSE({1,2;2,4})")), CalcError::Num);
    }

    #[test]
    fn non_square_value_error() {
        assert_eq!(e(&eval("=MINVERSE({1,2,3;4,5,6})")), CalcError::Value);
    }

    #[test]
    fn text_cell_value_error() {
        assert_eq!(e(&eval(r#"=MINVERSE({1,2;"x",4})"#)), CalcError::Value);
    }

    #[test]
    fn blank_cell_value_error() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 2.0.into()), ("B2", 4.0.into())],
            "=MINVERSE(A1:B2)",
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        assert_eq!(e(&eval("=MINVERSE({1,2;3,1/0})")), CalcError::DivZero);
    }

    #[test]
    fn needs_pivoting() {
        // Zero pivot in column 1 forces a row swap.
        assert_arr(&eval("=MINVERSE({0,2;1,0})"), 2, 2, &[0.0, 1.0, 0.5, 0.0]);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MINVERSE()")), CalcError::Value);
        assert_eq!(e(&eval("=MINVERSE({1},{2})")), CalcError::Value);
    }
}
