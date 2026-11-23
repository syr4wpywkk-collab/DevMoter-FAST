//! `SUMX2MY2(array_x, array_y)` — `SUM(x_i^2 - y_i^2)` over paired
//! arrays. Spec: `docs/functions/SUMX2MY2.md`.
//!
//! Pairing uses [`statistics::numeric_pairs`]: element *count* mismatch
//! is `#N/A` (shape is not compared — SPEC-OPEN there), a position
//! contributes only when both members are numbers, and error members
//! propagate.

use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    match statistics::numeric_pairs(ctx, &args[0], &args[1])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(pairs) => {
            let total: f64 = pairs.iter().map(|(x, y)| x * x - y * y).sum();
            if !total.is_finite() {
                return Ok(Value::Error(CalcError::Num));
            }
            Ok(Value::Number(total))
        }
    }
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

    fn inputs() -> [(&'static str, Value); 14] {
        [
            ("A1", 2.0.into()),
            ("A2", 3.0.into()),
            ("A3", 9.0.into()),
            ("A4", 1.0.into()),
            ("A5", 8.0.into()),
            ("A6", 7.0.into()),
            ("A7", 5.0.into()),
            ("B1", 6.0.into()),
            ("B2", 5.0.into()),
            ("B3", 11.0.into()),
            ("B4", 7.0.into()),
            ("B5", 5.0.into()),
            ("B6", 4.0.into()),
            ("B7", 4.0.into()),
        ]
    }

    #[test]
    fn microsoft_example_ranges() {
        let v = eval_with(&inputs(), "=SUMX2MY2(A1:A7,B1:B7)");
        assert_eq!(n(&v), -55.0);
    }

    #[test]
    fn microsoft_example_arrays() {
        assert_eq!(
            n(&eval("=SUMX2MY2({2,3,9,1,8,7,5},{6,5,11,7,5,4,4})")),
            -55.0
        );
    }

    #[test]
    fn scalars() {
        assert_eq!(n(&eval("=SUMX2MY2(3,2)")), 5.0);
    }

    #[test]
    fn count_mismatch_na() {
        let v = eval_with(&inputs(), "=SUMX2MY2(A1:A6,B1:B7)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn same_count_different_shape_ok() {
        // 7x1 vs 1x7: count compared, not shape (SPEC-OPEN).
        let v = eval_with(&inputs(), "=SUMX2MY2(A1:A7,B1:H1)");
        // B1:H1 only has B1 set; pairs at blank positions are skipped.
        assert_eq!(n(&v), 4.0 - 36.0);
    }

    #[test]
    fn text_position_skipped() {
        let v = eval_with(
            &[
                ("A1", 2.0.into()),
                ("A2", 9.0.into()),
                ("B1", "x".into()),
                ("B2", 1.0.into()),
            ],
            "=SUMX2MY2(A1:A2,B1:B2)",
        );
        // Only the (9,1) pair survives.
        assert_eq!(n(&v), 80.0);
    }

    #[test]
    fn blank_position_skipped() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", 9.0.into()), ("B2", 1.0.into())],
            "=SUMX2MY2(A1:A2,B1:B2)",
        );
        assert_eq!(n(&v), 80.0);
    }

    #[test]
    fn error_propagates() {
        let v = eval_with(&[("A1", 1.0.into())], "=SUMX2MY2(A1,1/0)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn empty_pairs_zero() {
        let v = eval_with(
            &[("A1", "x".into()), ("B1", "y".into())],
            "=SUMX2MY2(A1,B1)",
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn overflow_num() {
        assert_eq!(e(&eval("=SUMX2MY2(1e308,0)")), CalcError::Num);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SUMX2MY2(1)")), CalcError::Value);
        assert_eq!(e(&eval("=SUMX2MY2(1,2,3)")), CalcError::Value);
    }
}
