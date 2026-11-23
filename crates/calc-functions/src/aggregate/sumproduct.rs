//! `SUMPRODUCT(array1, [array2], ...)` — multiplies corresponding elements
//! of equal-shaped arrays and sums the products. Spec:
//! `docs/functions/SUMPRODUCT.md`.
//!
//! All arguments must share identical rows x cols; non-numeric elements
//! (text, boolean, blank) count as 0 per Excel's range-coercion model;
//! error elements propagate. A single argument sums its elements.

use crate::common::criteria;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let mut arrays: Vec<ArrayValue> = Vec::with_capacity(args.len());
    for expr in args {
        match criteria::eval_cells(ctx, expr)? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(a) => arrays.push(a),
        }
    }
    let (rows, cols) = (arrays[0].rows(), arrays[0].cols());
    if arrays.iter().any(|a| a.rows() != rows || a.cols() != cols) {
        return Ok(Value::Error(CalcError::Value));
    }

    let len = rows as usize * cols as usize;
    let mut total = 0.0;
    for i in 0..len {
        let mut product = 1.0;
        for a in &arrays {
            match &a.cells()[i] {
                Value::Number(n) => product *= *n,
                Value::Error(e) => return Ok(Value::Error(*e)),
                _ => product *= 0.0,
            }
        }
        total += product;
    }
    Ok(Value::Number(total))
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

    #[test]
    fn two_ranges() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 4.0.into()),
                ("B2", 5.0.into()),
                ("B3", 6.0.into()),
            ],
            "=SUMPRODUCT(A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), 32.0);
    }

    #[test]
    fn single_arg_sums() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=SUMPRODUCT(A1:A3)",
        );
        assert_eq!(n(&v), 6.0);
    }

    #[test]
    fn shape_mismatch_value_error() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            "=SUMPRODUCT(A1:A3,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn transposed_shape_mismatch() {
        // Same length, different orientation: 3x1 vs 1x3 -> #VALUE!.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 1.0.into()),
                ("C1", 2.0.into()),
                ("D1", 3.0.into()),
            ],
            "=SUMPRODUCT(A1:A3,B1:D1)",
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn text_counts_as_zero() {
        let v = eval_with(
            &[
                ("A1", 2.0.into()),
                ("A2", "x".into()),
                ("B1", 5.0.into()),
                ("B2", 5.0.into()),
            ],
            "=SUMPRODUCT(A1:A2,B1:B2)",
        );
        assert_eq!(n(&v), 10.0);
    }

    #[test]
    fn blank_counts_as_zero() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("B1", 5.0.into()), ("B2", 5.0.into())],
            "=SUMPRODUCT(A1:A2,B1:B2)",
        );
        assert_eq!(n(&v), 10.0);
    }

    #[test]
    fn booleans_count_as_zero() {
        let v = eval_with(
            &[("A1", Value::Boolean(true)), ("B1", 5.0.into())],
            "=SUMPRODUCT(A1,B1)",
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn two_d_ranges() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("B1", 2.0.into()),
                ("A2", 3.0.into()),
                ("B2", 4.0.into()),
                ("C1", 10.0.into()),
                ("D1", 10.0.into()),
                ("C2", 10.0.into()),
                ("D2", 10.0.into()),
            ],
            "=SUMPRODUCT(A1:B2,C1:D2)",
        );
        assert_eq!(n(&v), 100.0);
    }

    #[test]
    fn error_element_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("B1", 5.0.into())],
            "=SUMPRODUCT(A1,B1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn scalar_args() {
        assert_eq!(n(&eval("=SUMPRODUCT(3,4)")), 12.0);
    }

    #[test]
    fn three_arrays() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("B1", 3.0.into()), ("C1", 4.0.into())],
            "=SUMPRODUCT(A1,B1,C1)",
        );
        assert_eq!(n(&v), 24.0);
    }

    #[test]
    fn arity_zero_errors() {
        assert_eq!(e(&eval("=SUMPRODUCT()")), CalcError::Value);
    }
}
