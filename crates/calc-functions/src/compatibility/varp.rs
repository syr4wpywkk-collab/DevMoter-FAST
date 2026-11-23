//! `VARP(number1, [number2], ...)` — legacy population variance
//! (denominator n). Spec: `docs/functions/VARP.md`.
//!
//! Identical semantics and coercion split to `VAR.P` (the
//! SUM-family rule). `n = 0` numeric values -> `#DIV/0!`; `n = 1`
//! returns `0`.

use crate::common::coercion;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let nums = match coercion::collect_numbers(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    match statistics::population_variance(&nums) {
        Some(v) => Ok(Value::Number(v)),
        None => Ok(Value::Error(CalcError::DivZero)),
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

    #[test]
    fn doc_example() {
        // Excel doc: VARP(1345,...) = 678.84.
        let v = n(&eval(
            "=VARP(1345,1301,1368,1322,1310,1370,1318,1350,1303,1299)",
        ));
        assert!((v - 678.84).abs() < 1e-9, "got {v}");
    }

    #[test]
    fn basic() {
        // 2/3
        assert!((n(&eval("=VARP(1,2,3)")) - 0.6666667).abs() < 1e-7);
    }

    #[test]
    fn single_value_zero() {
        assert_eq!(n(&eval("=VARP(5)")), 0.0);
    }

    #[test]
    fn empty_range_div_zero() {
        let v = eval_with(&[("A1", Value::Text("x".into()))], "=VARP(A1:A3)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn matches_var_p() {
        assert_eq!(
            n(&eval("=VARP(2,4,4,4,5,5,7,9)")),
            n(&eval("=VAR.P(2,4,4,4,5,5,7,9)"))
        );
    }

    #[test]
    fn equals_stdevp_squared() {
        let v = n(&eval("=VARP(1,2,3,4,5)"));
        let s = n(&eval("=STDEVP(1,2,3,4,5)"));
        assert!((v - s * s).abs() < 1e-12);
    }

    #[test]
    fn relation_to_var() {
        // VARP = VAR * (n-1)/n
        let vp = n(&eval("=VARP(1,2,3,4,5)"));
        let vs = n(&eval("=VAR(1,2,3,4,5)"));
        assert!((vp - vs * 0.8).abs() < 1e-12);
    }

    #[test]
    fn bool_and_text_scalars_coerce() {
        // {1,4}: pop var = 2.25
        assert_eq!(n(&eval("=VARP(TRUE,\"4\")")), 2.25);
    }

    #[test]
    fn non_numeric_text_value() {
        assert_eq!(e(&eval("=VARP(\"x\",1,2)")), CalcError::Value);
    }

    #[test]
    fn range_ignores_text_and_booleans() {
        let v = eval_with(
            &[
                ("A1", Value::Boolean(true)),
                ("A2", Value::Number(1.0)),
                ("A3", Value::Number(3.0)),
            ],
            "=VARP(A1:A3)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Num))], "=VARP(A1:A2,1)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn bad_arity() {
        assert!(matches!(eval("=VARP()"), Value::Error(_)));
    }
}
