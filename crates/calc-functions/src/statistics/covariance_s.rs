//! `COVARIANCE.S(array1, array2)` — sample covariance
//! `Σ((x - x̄)(y - ȳ)) / (n - 1)`. Spec:
//! `docs/functions/COVARIANCE.S.md`.
//!
//! Same pairing rules as [`super::covariance_p`]; needs at least two
//! numeric pairs (`#DIV/0!` below that).

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
    if pairs.len() < 2 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    let s = statistics::pair_stats(&pairs);
    Ok(Value::Number(s.sxy / (s.n - 1) as f64))
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
    fn spec_example_proportional() {
        let v = n(&eval("=COVARIANCE.S({2,4,8},{6,12,18})"));
        assert!((v - 18.0).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn spec_example_self() {
        // = VAR.S(1,2,3)
        assert_eq!(n(&eval("=COVARIANCE.S({1,2,3},{1,2,3})")), 1.0);
    }

    #[test]
    fn spec_example_mixed() {
        let v = n(&eval("=COVARIANCE.S({1,2,3,4},{2,4,5,8})"));
        assert!((v - 3.1666666666666665).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn one_pair_is_divzero() {
        assert_eq!(e(&eval("=COVARIANCE.S({5},{5})")), CalcError::DivZero);
    }

    #[test]
    fn size_mismatch_is_na() {
        assert_eq!(e(&eval("=COVARIANCE.S({1,2},{1,2,3})")), CalcError::NA);
    }

    #[test]
    fn no_numeric_pairs_is_divzero() {
        assert_eq!(
            e(&eval(r#"=COVARIANCE.S({"a"},{"b"})"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn ranges_from_cells() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", 4.0.into()),
                ("B3", 5.0.into()),
                ("B4", 8.0.into()),
                ("A4", 4.0.into()),
            ],
            "=COVARIANCE.S(A1:A4,B1:B4)",
        );
        assert!((n(&v) - 3.1666666666666665).abs() < 1e-12);
    }

    #[test]
    fn text_in_range_skips_pair() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "skip".into()),
                ("A3", 3.0.into()),
                ("B1", 2.0.into()),
                ("B2", 4.0.into()),
                ("B3", 6.0.into()),
            ],
            "=COVARIANCE.S(A1:A3,B1:B3)",
        );
        // pairs (1,2),(3,6): sxy = 4, /1 = 4
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn error_member_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=COVARIANCE.S(A1:A2,{1,2})",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn negative_covariance() {
        assert_eq!(n(&eval("=COVARIANCE.S({1,2,3},{3,2,1})")), -1.0);
    }

    #[test]
    fn differs_from_population() {
        let s = n(&eval("=COVARIANCE.S({2,4,8},{6,12,18})"));
        let p = n(&eval("=COVARIANCE.P({2,4,8},{6,12,18})"));
        assert!((s - p * 1.5).abs() < 1e-12, "s={s} p={p}");
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=COVARIANCE.S(1/0,{1})")), CalcError::DivZero);
    }
}
