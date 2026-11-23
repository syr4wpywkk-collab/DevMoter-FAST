//! `COVARIANCE.P(array1, array2)` — population covariance
//! `Σ((x - x̄)(y - ȳ)) / n` over paired numeric values (legacy
//! `COVAR`). Spec: `docs/functions/COVARIANCE.P.md`.
//!
//! Pairing/filtering via [`statistics::numeric_pairs`]: equal raw
//! member counts are required (`#N/A`), a pair survives only when both
//! members are numeric, error members propagate. The deviation-form
//! accumulator comes from [`statistics::pair_stats`].

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
    fn spec_example_proportional() {
        let v = n(&eval("=COVARIANCE.P({2,4,8},{6,12,18})"));
        assert!((v - 12.0).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn spec_example_self() {
        // = VAR.P(1,2,3)
        let v = n(&eval("=COVARIANCE.P({1,2,3},{1,2,3})"));
        assert!((v - 0.6666666666666666).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn spec_example_zero() {
        assert_eq!(n(&eval("=COVARIANCE.P({1,2},{5,5})")), 0.0);
    }

    #[test]
    fn size_mismatch_is_na() {
        assert_eq!(e(&eval("=COVARIANCE.P({1,2},{1,2,3})")), CalcError::NA);
    }

    #[test]
    fn no_numeric_pairs_is_divzero() {
        assert_eq!(
            e(&eval(r#"=COVARIANCE.P({"a"},{"b"})"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn ranges_from_cells() {
        let v = eval_with(
            &[
                ("A1", 2.0.into()),
                ("A2", 4.0.into()),
                ("A3", 8.0.into()),
                ("B1", 6.0.into()),
                ("B2", 12.0.into()),
                ("B3", 18.0.into()),
            ],
            "=COVARIANCE.P(A1:A3,B1:B3)",
        );
        assert!((n(&v) - 12.0).abs() < 1e-12);
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
            "=COVARIANCE.P(A1:A3,B1:B3)",
        );
        // pairs (1,2) and (3,6): sxy = 4, /2 = 2
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn error_member_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::Ref)), ("A2", 1.0.into())],
            "=COVARIANCE.P(A1:A2,{1,2})",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }

    #[test]
    fn negative_covariance() {
        let v = n(&eval("=COVARIANCE.P({1,2,3},{3,2,1})"));
        assert!((v + 0.6666666666666666).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn non_numeric_scalar_is_value() {
        assert_eq!(e(&eval(r#"=COVARIANCE.P("x",{1})"#)), CalcError::Value);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=COVARIANCE.P(1/0,{1})")), CalcError::DivZero);
    }
}
