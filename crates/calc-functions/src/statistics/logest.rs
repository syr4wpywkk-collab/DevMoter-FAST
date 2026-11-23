//! `LOGEST(known_ys, [known_xs], [const], [stats])` — exponential
//! regression `y = b * m1^x1 * ...` computed as `LINEST` on `ln(y)`.
//! Spec: `docs/functions/LOGEST.md`.
//!
//! All shape/coercion/stats semantics are [`super::linest`]'s; only the
//! log transform and the `const = FALSE` intercept default (`b = 1`,
//! not `0`) differ. Non-positive `y` returns `#VALUE!` (the spec doc's
//! `#VALUE!` vs `#NUM!` question is SPEC-OPEN).

use crate::statistics::linest;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    linest::run(ctx, args, true)
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn cells(v: &Value) -> Vec<Value> {
        match v {
            Value::Array(a) => a.iter().cloned().collect(),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn nums(v: &Value) -> Vec<f64> {
        cells(v)
            .iter()
            .map(|c| match c {
                Value::Number(n) => *n,
                o => panic!("expected number cell, got {o:?}"),
            })
            .collect()
    }

    fn shape(v: &Value) -> (u32, u32) {
        match v {
            Value::Array(a) => (a.rows(), a.cols()),
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
    fn doc_example_doubling() {
        // LOGEST({2;4;8;16},{1;2;3;4}) -> {2, 1}.
        let c = nums(&eval("=LOGEST({2;4;8;16},{1;2;3;4})"));
        assert!((c[0] - 2.0).abs() < 1e-12);
        assert!((c[1] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn doc_example_implicit_xs() {
        // A1:A3 = 1,10,100 -> {10, 0.1}.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 10.0.into()),
                ("A3", 100.0.into()),
            ],
            "=LOGEST(A1:A3)",
        );
        let c = nums(&v);
        assert!((c[0] - 10.0).abs() < 1e-9);
        assert!((c[1] - 0.1).abs() < 1e-9);
    }

    #[test]
    fn doc_example_stats_block() {
        let v = eval("=LOGEST({3;6;12;24},{1;2;3;4},TRUE,TRUE)");
        assert_eq!(shape(&v), (5, 2));
        // Perfect exponential fit -> R^2 = 1.
        let c = cells(&v);
        match &c[4] {
            Value::Number(r2) => assert!((*r2 - 1.0).abs() < 1e-9),
            o => panic!("expected R^2 number, got {o:?}"),
        }
    }

    #[test]
    fn const_false_b_is_one() {
        // LOGEST with const=FALSE: intercept slot is 1, not 0.
        let c = nums(&eval("=LOGEST({2;4;8;16},{1;2;3;4},FALSE)"));
        assert!((c[0] - 2.0).abs() < 1e-12);
        assert_eq!(c[1], 1.0);
    }

    #[test]
    fn nonpositive_y_value_error() {
        assert_eq!(e(&eval("=LOGEST({1;0;3},{1;2;3})")), CalcError::Value);
        assert_eq!(e(&eval("=LOGEST({1;-2;3},{1;2;3})")), CalcError::Value);
    }

    #[test]
    fn noisy_exponential() {
        // y = 3 * 2^x + wiggle: check coefficient near 2.
        let v = eval_with(
            &[
                ("A1", 6.1.into()),
                ("A2", 11.8.into()),
                ("A3", 24.2.into()),
                ("A4", 47.9.into()),
            ],
            "=LOGEST(A1:A4)",
        );
        let c = nums(&v);
        assert!((c[0] - 2.0).abs() < 0.05);
        assert!((c[1] - 3.0).abs() < 0.3);
    }

    #[test]
    fn row_vector_ys() {
        let c = nums(&eval("=LOGEST({2,4,8,16},{1,2,3,4})"));
        assert!((c[0] - 2.0).abs() < 1e-12);
    }

    #[test]
    fn mismatched_xs_ref_error() {
        assert_eq!(e(&eval("=LOGEST({1;2;4},{1;2})")), CalcError::Ref);
    }

    #[test]
    fn text_cell_value_error() {
        let v = eval_with(&[("A1", 1.0.into()), ("A2", "x".into())], "=LOGEST(A1:A2)");
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", Value::Error(CalcError::NA))],
            "=LOGEST(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn two_x_variables() {
        // y = 4 * 2^x1 * 3^x2 exactly, independent xs columns.
        // x1 = 1..4, x2 = 1,2,1,2 -> y = 4*2*3, 4*4*9, 4*8*3, 4*16*9.
        let v = eval("=LOGEST({24;144;96;576},{1,1;2,2;3,1;4,2})");
        let c = nums(&v);
        assert!((c[0] - 3.0).abs() < 1e-9); // m2
        assert!((c[1] - 2.0).abs() < 1e-9); // m1
        assert!((c[2] - 4.0).abs() < 1e-9); // b
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=LOGEST()")), CalcError::Value);
    }
}
