//! `RSQ(known_ys, known_xs)` — square of the Pearson correlation
//! coefficient. Spec: `docs/functions/RSQ.md`.
//!
//! Same pairing rules as `CORREL` (positional pairing, non-numeric
//! members drop the pair, errors propagate, raw count mismatch is
//! `#N/A`). `r²` is computed from the shared [`PairStats`] accumulator.

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
    let pairs = match statistics::numeric_pairs(ctx, &args[0], &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    if pairs.is_empty() {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let st = statistics::pair_stats(&pairs);
    if st.sxx == 0.0 || st.syy == 0.0 {
        // Covers n < 2 pairs and zero variance in either input.
        return Ok(Value::Error(CalcError::DivZero));
    }
    let r = st.sxy / (st.sxx * st.syy).sqrt();
    Ok(Value::Number(r * r))
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
    fn excel_doc_example() {
        // {2;3;9;1;8;7;5} vs {6;5;11;7;5;4;4} -> 0.05795.
        let v = eval_with(
            &[
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
            ],
            "=RSQ(A1:A7,B1:B7)",
        );
        assert!((n(&v) - 0.05795).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn perfect_positive_is_one() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", 4.0.into()),
                ("B3", 6.0.into()),
            ],
            "=RSQ(A1:A3,B1:B3)",
        );
        assert!((n(&v) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn perfect_negative_is_one() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("A4", 4.0.into()),
                ("B1", 4.0.into()),
                ("B2", 3.0.into()),
                ("B3", 2.0.into()),
                ("B4", 1.0.into()),
            ],
            "=RSQ(A1:A4,B1:B4)",
        );
        assert!((n(&v) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn matches_correl_squared() {
        let cells = [
            ("A1", 1.0.into()),
            ("A2", 5.0.into()),
            ("A3", 2.0.into()),
            ("B1", 3.0.into()),
            ("B2", 1.0.into()),
            ("B3", 8.0.into()),
        ];
        let r = n(&eval_with(&cells, "=CORREL(A1:A3,B1:B3)"));
        let r2 = n(&eval_with(&cells, "=RSQ(A1:A3,B1:B3)"));
        assert!((r2 - r * r).abs() < 1e-12);
    }

    #[test]
    fn zero_variance_x_div_zero() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 5.0.into()),
                ("B2", 5.0.into()),
                ("B3", 5.0.into()),
            ],
            "=RSQ(A1:A3,B1:B3)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn count_mismatch_na() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 1.0.into()), ("B2", 2.0.into())],
            "=RSQ(A1:A1,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn empty_pair_set_div_zero() {
        let v = eval_with(
            &[("A1", "x".into()), ("B1", "y".into())],
            "=RSQ(A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn single_pair_div_zero() {
        // One pair has zero variance.
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 2.0.into())],
            "=RSQ(A1:A1,B1:B1)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn non_numeric_pair_excluded() {
        // B2 text drops pair 2; remaining pairs (1,2) and (3,5).
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", "x".into()),
                ("B3", 5.0.into()),
            ],
            "=RSQ(A1:A3,B1:B3)",
        );
        let r2 = n(&v);
        assert!((0.0..=1.0 + 1e-9).contains(&r2), "got {r2}");
    }

    #[test]
    fn result_in_unit_interval() {
        let cells = [
            ("A1", 4.0.into()),
            ("A2", 2.0.into()),
            ("A3", 7.0.into()),
            ("A4", 1.0.into()),
            ("B1", 3.0.into()),
            ("B2", 9.0.into()),
            ("B3", 2.0.into()),
            ("B4", 8.0.into()),
        ];
        let r2 = n(&eval_with(&cells, "=RSQ(A1:A4,B1:B4)"));
        assert!((0.0..=1.0 + 1e-12).contains(&r2));
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[
                ("A1", Value::Error(CalcError::NA)),
                ("A2", 1.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            "=RSQ(A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn scalar_args_pair() {
        // Two scalar args form a single pair -> zero variance error.
        assert_eq!(e(&eval("=RSQ(1,2)")), CalcError::DivZero);
    }
}
