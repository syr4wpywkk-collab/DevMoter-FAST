//! `STEYX(known_ys, known_xs)` — standard error of the predicted y in
//! the linear regression of `known_ys` on `known_xs`. Spec:
//! `docs/functions/STEYX.md`.
//!
//! `sqrt( (Syy - Sxy²/Sxx) / (n - 2) )` over the numeric pairs;
//! `n < 3` or `Sxx = 0` -> `#DIV/0!`.

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
    // Spec order is (ys, xs); pair_stats takes (x, y).
    let pairs = match statistics::numeric_pairs(ctx, &args[1], &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    if pairs.len() < 3 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let st = statistics::pair_stats(&pairs);
    if st.sxx == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let ss_resid = st.syy - st.sxy * st.sxy / st.sxx;
    // Clamp tiny negative FP residue on a perfect fit.
    Ok(Value::Number(
        (ss_resid.max(0.0) / (st.n - 2) as f64).sqrt(),
    ))
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
        // {2;3;9;1;8;7;5} on {6;5;11;7;5;4;4} -> 3.305719.
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
            "=STEYX(A1:A7,B1:B7)",
        );
        assert!((n(&v) - 3.305719).abs() < 1e-5, "got {v}");
    }

    #[test]
    fn perfect_fit_gives_zero() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("A4", 4.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
                ("B4", 4.0.into()),
            ],
            "=STEYX(A1:A4,B1:B4)",
        );
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn x_zero_variance_div_zero() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 5.0.into()),
                ("B2", 5.0.into()),
                ("B3", 5.0.into()),
            ],
            "=STEYX(A1:A3,B1:B3)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn two_pairs_div_zero() {
        // n - 2 = 0 denominator.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            "=STEYX(A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn count_mismatch_na() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("B1", 1.0.into()), ("B2", 2.0.into())],
            "=STEYX(A1:A1,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn non_numeric_pair_excluded() {
        // Dropping B2 leaves 3 pairs.
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("A4", 4.0.into()),
                ("B1", 2.0.into()),
                ("B2", "x".into()),
                ("B3", 4.0.into()),
                ("B4", 5.0.into()),
            ],
            "=STEYX(A1:A4,B1:B4)",
        );
        assert!(n(&v).is_finite());
    }

    #[test]
    fn empty_pair_set_div_zero() {
        let v = eval_with(
            &[("A1", "x".into()), ("B1", "y".into())],
            "=STEYX(A1:A3,B1:B3)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[
                ("A1", Value::Error(CalcError::NA)),
                ("A2", 1.0.into()),
                ("A3", 2.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            "=STEYX(A1:A3,B1:B3)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn known_affine_fit_zero() {
        // y = 2x + 1 exactly.
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 5.0.into()),
                ("A3", 7.0.into()),
                ("A4", 9.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
                ("B4", 4.0.into()),
            ],
            "=STEYX(A1:A4,B1:B4)",
        );
        assert!(n(&v).abs() < 1e-12);
    }

    #[test]
    fn larger_scatter_larger_error() {
        // More scatter around the line -> larger STEYX.
        let tight = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 5.0.into()),
                ("A3", 7.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            "=STEYX(A1:A3,B1:B3)",
        );
        let loose = eval_with(
            &[
                ("C1", 3.0.into()),
                ("C2", 9.0.into()),
                ("C3", 4.0.into()),
                ("D1", 1.0.into()),
                ("D2", 2.0.into()),
                ("D3", 3.0.into()),
            ],
            "=STEYX(C1:C3,D1:D3)",
        );
        assert!(n(&loose) > n(&tight));
    }
}
