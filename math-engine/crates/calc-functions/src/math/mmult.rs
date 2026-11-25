//! `MMULT(array1, array2)` — matrix product of two numeric arrays.
//! Spec: `docs/functions/MMULT.md`.
//!
//! `cols(array1)` must equal `rows(array2)` (`#VALUE!` otherwise);
//! blank/text/boolean cells are `#VALUE!`; error cells propagate.
//! Booleans inside ranges are treated as non-numeric -> `#VALUE!`
//! (SPEC-OPEN in the spec doc asks error vs ignored; MMULT's
//! "only numbers" rule reads as error).

use super::matrix;
use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let a1 = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let a2 = match coercion::eval_array(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let (r1, c1, m1) = match matrix::to_f64_matrix(&a1) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };
    let (r2, c2, m2) = match matrix::to_f64_matrix(&a2) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };
    if c1 != r2 {
        return Ok(Value::Error(calc_core::CalcError::Value));
    }
    let mut out = vec![0.0f64; r1 * c2];
    for i in 0..r1 {
        for k in 0..c1 {
            let a = m1[i * c1 + k];
            if a == 0.0 {
                continue;
            }
            for j in 0..c2 {
                out[i * c2 + j] += a * m2[k * c2 + j];
            }
        }
    }
    match ArrayValue::new(
        r1 as u32,
        c2 as u32,
        out.into_iter().map(Value::Number).collect(),
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

    #[test]
    fn spec_2x2() {
        let (r, c, got) = arr(&eval("=MMULT({1,3;7,2},{5,0;2,3})"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(got, vec![11.0, 9.0, 39.0, 6.0]);
    }

    #[test]
    fn spec_3x2_by_2x2() {
        let (r, c, got) = arr(&eval("=MMULT({3,0;-3,0;0,2},{2,0;0,1})"));
        assert_eq!((r, c), (3, 2));
        assert_eq!(got, vec![6.0, 0.0, -6.0, 0.0, 0.0, 2.0]);
    }

    #[test]
    fn row_times_column() {
        let (r, c, got) = arr(&eval("=MMULT({1,2,3},{4;5;6})"));
        assert_eq!((r, c), (1, 1));
        assert_eq!(got, vec![32.0]);
    }

    #[test]
    fn column_times_row() {
        let (r, c, got) = arr(&eval("=MMULT({1;2},{3,4})"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(got, vec![3.0, 4.0, 6.0, 8.0]);
    }

    #[test]
    fn scalar_scalar() {
        let (r, c, got) = arr(&eval("=MMULT(3,4)"));
        assert_eq!((r, c), (1, 1));
        assert_eq!(got, vec![12.0]);
    }

    #[test]
    fn range_inputs() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("B1", 3.0.into()),
                ("A2", 7.0.into()),
                ("B2", 2.0.into()),
                ("D1", 5.0.into()),
                ("E1", 0.0.into()),
                ("D2", 2.0.into()),
                ("E2", 3.0.into()),
            ],
            "=MMULT(A1:B2,D1:E2)",
        );
        let (_, _, got) = arr(&v);
        assert_eq!(got, vec![11.0, 9.0, 39.0, 6.0]);
    }

    #[test]
    fn identity_multiply() {
        let (r, c, got) = arr(&eval("=MMULT({1,0;0,1},{5,6;7,8})"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(got, vec![5.0, 6.0, 7.0, 8.0]);
    }

    #[test]
    fn dimension_mismatch() {
        assert_eq!(e(&eval("=MMULT({1,2},{3,4})")), CalcError::Value);
        assert_eq!(e(&eval("=MMULT({1,2;3,4},{5;6;7})")), CalcError::Value);
    }

    #[test]
    fn text_cell_value_error() {
        assert_eq!(e(&eval(r#"=MMULT({1,"x"},{2;3})"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=MMULT({1,2},{"x";3})"#)), CalcError::Value);
    }

    #[test]
    fn blank_cell_value_error() {
        // A2 participates in the range but is blank -> #VALUE!.
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 2.0.into()), ("B2", 4.0.into())],
            "=MMULT(A1:B2,{1;1})",
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        assert_eq!(e(&eval("=MMULT({1/0},{2})")), CalcError::DivZero);
        assert_eq!(e(&eval("=MMULT({1},{1/0})")), CalcError::DivZero);
    }

    #[test]
    fn fractional_result() {
        let (_, _, got) = arr(&eval("=MMULT({0.5,0.5},{2;4})"));
        assert_eq!(got, vec![3.0]);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MMULT({1})")), CalcError::Value);
        assert_eq!(e(&eval("=MMULT({1},{2},{3})")), CalcError::Value);
    }
}
