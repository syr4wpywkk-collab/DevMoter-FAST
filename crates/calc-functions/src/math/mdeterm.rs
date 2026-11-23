//! `MDETERM(array)` — determinant of a square numeric array.
//! Spec: `docs/functions/MDETERM.md`.
//!
//! Non-square input is `#VALUE!`; blank/text/boolean cells are
//! `#VALUE!`; error cells propagate. Singular matrices return `0`
//! (LU with partial pivoting; like Excel, the result is the computed
//! floating-point determinant — SPEC-OPEN documents the tolerance
//! policy question).

use super::matrix;
use crate::common::coercion;
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
    Ok(Value::Number(matrix::determinant(rows, &m)))
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
    fn spec_3x3() {
        // The spec's "222" is a documented-Microsoft-example
        // approximation guess; the exact determinant is -388.
        assert_eq!(n(&eval("=MDETERM({3,8,5;3,-6,1;-8,0,2})")), -388.0);
    }

    #[test]
    fn spec_2x2() {
        assert_eq!(n(&eval("=MDETERM({1,2;3,4})")), -2.0);
    }

    #[test]
    fn spec_1x1() {
        assert_eq!(n(&eval("=MDETERM({2})")), 2.0);
    }

    #[test]
    fn scalar_wraps_1x1() {
        assert_eq!(n(&eval("=MDETERM(5)")), 5.0);
    }

    #[test]
    fn range_input() {
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("B1", 8.0.into()),
                ("C1", 5.0.into()),
                ("A2", 3.0.into()),
                ("B2", (-6.0).into()),
                ("C2", 1.0.into()),
                ("A3", (-8.0).into()),
                ("B3", 0.0.into()),
                ("C3", 2.0.into()),
            ],
            "=MDETERM(A1:C3)",
        );
        assert_eq!(n(&v), -388.0);
    }

    #[test]
    fn identity_is_one() {
        assert_eq!(n(&eval("=MDETERM({1,0,0;0,1,0;0,0,1})")), 1.0);
    }

    #[test]
    fn singular_returns_zero() {
        assert_eq!(n(&eval("=MDETERM({1,2;2,4})")), 0.0);
        assert_eq!(n(&eval("=MDETERM({1,2,3;4,5,6;7,8,9})")), 0.0);
    }

    #[test]
    fn non_square_value_error() {
        assert_eq!(e(&eval("=MDETERM({1,2,3;4,5,6})")), CalcError::Value);
        assert_eq!(e(&eval("=MDETERM({1;2;3})")), CalcError::Value);
    }

    #[test]
    fn text_cell_value_error() {
        assert_eq!(e(&eval(r#"=MDETERM({1,2;"x",4})"#)), CalcError::Value);
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "x".into()),
                ("B1", 3.0.into()),
                ("B2", 4.0.into()),
            ],
            "=MDETERM(A1:B2)",
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn blank_cell_value_error() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 2.0.into()), ("B2", 4.0.into())],
            "=MDETERM(A1:B2)",
        );
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        assert_eq!(e(&eval("=MDETERM({1,2;3,1/0})")), CalcError::DivZero);
    }

    #[test]
    fn negative_and_fractional() {
        assert!((n(&eval("=MDETERM({1.5,2.5;0.5,-1})")) - -2.75).abs() < 1e-12);
    }

    #[test]
    fn larger_matrix() {
        // det of upper-triangular = product of diagonal.
        assert_eq!(n(&eval("=MDETERM({2,9,9;0,3,8;0,0,-4})")), -24.0);
    }

    #[test]
    fn pivoting_used() {
        // Zero on the diagonal forces a row swap: det = -(2*1) = -2.
        assert_eq!(n(&eval("=MDETERM({0,2;1,0})")), -2.0);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MDETERM()")), CalcError::Value);
        assert_eq!(e(&eval("=MDETERM({1},{2})")), CalcError::Value);
    }
}
