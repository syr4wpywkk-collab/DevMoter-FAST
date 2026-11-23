//! `COVAR(array1, array2)` — legacy population covariance
//! `Σ((x - x̄)(y - ȳ)) / n` over paired numeric values; equivalent to
//! `COVARIANCE.P` (NOT `COVARIANCE.S`). Spec: `docs/functions/COVAR.md`.
//!
//! Pairing/filtering via [`statistics::numeric_pairs`]: equal raw
//! member counts required (`#N/A`), a pair survives only when both
//! members are numeric, error members propagate. No valid pairs ->
//! `#DIV/0!`.

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
    let s = statistics::pair_stats(&pairs);
    Ok(Value::Number(s.sxy / s.n as f64))
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
    fn spec_example() {
        let v = n(&eval("=COVAR({3,2,4,5,6},{9,7,12,15,17})"));
        assert!((v - 5.2).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn spec_example_two_thirds() {
        let v = n(&eval("=COVAR({1,2,3},{4,5,6})"));
        assert!((v - 2.0 / 3.0).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn size_mismatch_na() {
        assert_eq!(e(&eval("=COVAR({1,2,3},{1,2})")), CalcError::NA);
    }

    #[test]
    fn no_numeric_pairs_div0() {
        assert_eq!(e(&eval(r#"=COVAR({"a"},{"b"})"#)), CalcError::DivZero);
    }

    #[test]
    fn single_pair_zero() {
        assert_eq!(n(&eval("=COVAR({3},{7})")), 0.0);
    }

    #[test]
    fn pairwise_text_skip() {
        // Text member drops the pair: only (2,5),(3,6) remain.
        let v = eval_with(&[("A1", "x".into())], "=COVAR({A1,2,3},{4,5,6})");
        assert!((n(&v) - 0.25).abs() < 1e-12, "got {v:?}");
    }

    #[test]
    fn ranges_from_cells() {
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 2.0.into()),
                ("A3", 4.0.into()),
                ("B1", 9.0.into()),
                ("B2", 7.0.into()),
                ("B3", 12.0.into()),
            ],
            "=COVAR(A1:A3,B1:B3)",
        );
        assert!((n(&v) - 5.0 / 3.0).abs() < 1e-12, "got {v:?}");
    }

    #[test]
    fn error_member_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=COVAR({A1,2},{3,4})",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn blank_pairs_skipped() {
        // Blank A1 removes the pair; leaves (2,5),(3,6).
        let v = eval_with(&[], "=COVAR({A1,2,3},{4,5,6})");
        assert!((n(&v) - 0.25).abs() < 1e-12, "got {v:?}");
    }

    #[test]
    fn matches_modern_equivalent() {
        let a = n(&eval("=COVAR({3,2,4,5,6},{9,7,12,15,17})"));
        let b = n(&eval("=COVARIANCE.P({3,2,4,5,6},{9,7,12,15,17})"));
        assert_eq!(a, b);
    }
}
