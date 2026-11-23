//! `PEARSON(array1, array2)` — Pearson correlation; identical result
//! to `CORREL` (spec adopts CORREL's rules wholesale).
//! Spec: `docs/functions/PEARSON.md`.

use crate::statistics::correl;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    correl::call(ctx, args)
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
        assert!((n(&eval("=PEARSON({1;2;3},{1;2;3})")) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn perfect_negative() {
        assert!((n(&eval("=PEARSON({1;2;3},{3;2;1})")) + 1.0).abs() < 1e-12);
    }

    #[test]
    fn doc_example() {
        // Excel doc data: {9;7;5;3;1} vs {10;6;1;5;3} -> 0.699379.
        assert!((n(&eval("=PEARSON({9;7;5;3;1},{10;6;1;5;3})")) - 0.699379).abs() < 1e-5);
    }

    #[test]
    fn identical_to_correl() {
        let p = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 4.0.into()),
                ("A3", 9.0.into()),
                ("B1", 3.0.into()),
                ("B2", 5.0.into()),
                ("B3", 8.0.into()),
            ],
            "=PEARSON(A1:A3,B1:B3)",
        );
        let c = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 4.0.into()),
                ("A3", 9.0.into()),
                ("B1", 3.0.into()),
                ("B2", 5.0.into()),
                ("B3", 8.0.into()),
            ],
            "=CORREL(A1:A3,B1:B3)",
        );
        assert_eq!(n(&p), n(&c));
    }

    #[test]
    fn pair_exclusion() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", "x".into()),
                ("B3", 6.0.into()),
            ],
            "=PEARSON(A1:A3,B1:B3)",
        );
        assert!((n(&v) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn count_mismatch_na() {
        assert_eq!(e(&eval("=PEARSON({1;2;3},{1;2})")), CalcError::NA);
    }

    #[test]
    fn zero_variance_div0() {
        assert_eq!(e(&eval("=PEARSON({2;2;2},{1;2;3})")), CalcError::DivZero);
    }

    #[test]
    fn no_pairs_div0() {
        let v = eval_with(
            &[("A1", "x".into()), ("B1", "y".into())],
            "=PEARSON(A1:B1,C1:D1)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=PEARSON({1;2;3},{1;2;1/0})")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=PEARSON({1;2})")), CalcError::Value);
        assert_eq!(e(&eval("=PEARSON({1},{1},{1})")), CalcError::Value);
    }
}
