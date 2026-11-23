//! `GAMMALN.PRECISE(x)` — identical to `GAMMALN` (Excel 2010+ rename).
//! Spec: `docs/functions/GAMMALN.PRECISE.md`.
//!
//! Shares the `GAMMALN` implementation; the Lanczos kernel already
//! carries ~1e-15 relative accuracy, so no distinct "precise" path is
//! needed within `f64` (see the spec's open question).

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    crate::statistics::gammaln::call(ctx, args)
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
    fn spec_example_ln6() {
        assert!((n(&eval("=GAMMALN.PRECISE(4)")) - 1.791759469228055).abs() < 1e-14);
    }

    #[test]
    fn spec_example_ln_sqrt_pi() {
        assert!((n(&eval("=GAMMALN.PRECISE(0.5)")) - 0.5723649429247001).abs() < 1e-14);
    }

    #[test]
    fn matches_gammaln() {
        for x in [0.1, 0.9, 1.0, 2.0, 7.3, 50.0] {
            let a = eval(&format!("=GAMMALN({x})"));
            let b = eval(&format!("=GAMMALN.PRECISE({x})"));
            assert_eq!(a, b);
        }
    }

    #[test]
    fn zero_num() {
        assert_eq!(e(&eval("=GAMMALN.PRECISE(0)")), CalcError::Num);
    }

    #[test]
    fn negative_num() {
        assert_eq!(e(&eval("=GAMMALN.PRECISE(-1)")), CalcError::Num);
    }

    #[test]
    fn near_one_cancellation() {
        // ln Γ(1+1e-9) ≈ -5.77e-10 (Euler–Mascheroni region).
        let v = n(&eval("=GAMMALN.PRECISE(1.000000001)"));
        assert!(v.abs() < 1e-8 && v < 0.0, "got {v}");
    }

    #[test]
    fn large_x() {
        // ln Γ(171) is finite (~7.06e2) even though Γ(171) overflows.
        let v = n(&eval("=GAMMALN.PRECISE(171)"));
        assert!((v - 706.5730622457874).abs() < 1e-10, "got {v}");
    }

    #[test]
    fn text_value_error() {
        assert_eq!(e(&eval(r#"=GAMMALN.PRECISE("a")"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert!((n(&eval(r#"=GAMMALN.PRECISE("4")"#)) - 1.791759469228055).abs() < 1e-14);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 10.0.into())], "=GAMMALN.PRECISE(A1)");
        assert!((n(&v) - 12.801827480081469).abs() < 1e-13);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=GAMMALN.PRECISE(A1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=GAMMALN.PRECISE()")), CalcError::Value);
        assert_eq!(e(&eval("=GAMMALN.PRECISE(1,2)")), CalcError::Value);
    }
}
