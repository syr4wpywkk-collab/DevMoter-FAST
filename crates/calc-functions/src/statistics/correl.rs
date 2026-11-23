//! `CORREL(array1, array2)` — Pearson correlation coefficient.
//! Spec: `docs/functions/CORREL.md`.
//!
//! Pairwise exclusion: a pair survives only when both members are
//! numeric; errors propagate; raw member-count mismatch is `#N/A`.

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
        // n = 1 pair also lands here (zero variance).
        return Ok(Value::Error(CalcError::DivZero));
    }
    // SPEC-OPEN (CORREL.md): Excel does not document clamping; the raw
    // value is returned, tiny FP excursions past ±1 are not corrected.
    Ok(Value::Number(st.sxy / (st.sxx * st.syy).sqrt()))
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
    fn perfect_positive() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", 4.0.into()),
                ("B3", 6.0.into()),
            ],
            "=CORREL(A1:A3,B1:B3)",
        );
        assert!((n(&v) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn perfect_negative() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 6.0.into()),
                ("B2", 4.0.into()),
                ("B3", 2.0.into()),
            ],
            "=CORREL(A1:A3,B1:B3)",
        );
        assert!((n(&v) + 1.0).abs() < 1e-12);
    }

    #[test]
    fn uncorrelated_orthogonal() {
        // {1,-1,0} vs {0,0,1}: covariance 0 -> r = 0.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", (-1.0).into()),
                ("A3", 0.0.into()),
                ("B1", 0.0.into()),
                ("B2", 0.0.into()),
                ("B3", 1.0.into()),
            ],
            "=CORREL(A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn pair_exclusion_non_numeric() {
        // B2 is text: pair 2 dropped, leaving {(1,2),(3,6)} -> r = 1.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", "x".into()),
                ("B3", 6.0.into()),
            ],
            "=CORREL(A1:A3,B1:B3)",
        );
        assert!((n(&v) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn blank_pair_dropped() {
        // A2 blank: pair 2 dropped -> {(1,1),(3,3)} -> r = 1.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A3", 3.0.into()),
                ("B1", 1.0.into()),
                ("B2", 5.0.into()),
                ("B3", 3.0.into()),
            ],
            "=CORREL(A1:A3,B1:B3)",
        );
        assert!((n(&v) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn size_mismatch_na() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 1.0.into()), ("B2", 2.0.into())],
            "=CORREL(A1:A1,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn zero_variance_div_zero() {
        let v = eval_with(
            &[
                ("A1", 5.0.into()),
                ("A2", 5.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            "=CORREL(A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn all_pairs_excluded_div_zero() {
        let v = eval_with(
            &[("A1", "x".into()), ("B1", 1.0.into())],
            "=CORREL(A1:A1,B1:B1)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", Value::Error(CalcError::Ref)),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            "=CORREL(A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }

    #[test]
    fn two_d_ranges_paired_row_major() {
        // 2x2 ranges: pairs (A1,D1),(B1,E1),(A2,D2),(B2,E2) row-major.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("B1", 2.0.into()),
                ("A2", 3.0.into()),
                ("B2", 4.0.into()),
                ("D1", 2.0.into()),
                ("E1", 4.0.into()),
                ("D2", 6.0.into()),
                ("E2", 8.0.into()),
            ],
            "=CORREL(A1:B2,D1:E2)",
        );
        assert!((n(&v) - 1.0).abs() < 1e-12);
    }
}
