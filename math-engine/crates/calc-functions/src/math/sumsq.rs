//! `SUMSQ(number1, [number2], ...)` — sum of squares of the arguments.
//! Spec: `docs/functions/SUMSQ.md`.
//!
//! Uses the SUM-family collection rule ([`statistics::arg_members`] +
//! [`statistics::member_number`]): direct scalars coerce (text/booleans
//! count), range/array members contribute
//! only numbers (text/boolean/blank ignored — booleans inside ranges
//! ignored per the shared model), error cells propagate. A range with
//! no numbers returns 0. Overflow to non-finite -> `#NUM!`.

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
    let mut total = 0.0;
    for expr in args {
        for (v, ranged) in statistics::arg_members(ctx, expr)? {
            match statistics::member_number(&v, ranged) {
                Err(e) => return Ok(Value::Error(e)),
                Ok(Some(x)) => total += x * x,
                Ok(None) => {}
            }
        }
    }
    if !total.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(total))
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
        assert_eq!(n(&eval("=SUMSQ(3,4)")), 25.0);
    }

    #[test]
    fn inline_array() {
        assert_eq!(n(&eval("=SUMSQ({1,2;3,4})")), 30.0);
    }

    #[test]
    fn range_sums_numeric_cells() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", "x".into()), ("A3", 3.0.into())],
            "=SUMSQ(A1:A3)",
        );
        assert_eq!(n(&v), 10.0);
    }

    #[test]
    fn bool_in_range_ignored() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", Value::Boolean(true))],
            "=SUMSQ(A1:A2)",
        );
        assert_eq!(n(&v), 4.0);
    }

    #[test]
    fn bool_direct_counts() {
        assert_eq!(n(&eval("=SUMSQ(TRUE,3)")), 10.0);
    }

    #[test]
    fn text_direct_counts() {
        assert_eq!(n(&eval("=SUMSQ(\"3\",4)")), 25.0);
    }

    #[test]
    fn blank_range_ignored() {
        let v = eval_with(&[("A1", 5.0.into()), ("A2", Value::Blank)], "=SUMSQ(A1:A2)");
        assert_eq!(n(&v), 25.0);
    }

    #[test]
    fn no_numbers_returns_zero() {
        let v = eval_with(&[("A1", "x".into())], "=SUMSQ(A1:A3)");
        assert_eq!(n(&v), 0.0);
    }

    #[test]
    fn bad_text_direct() {
        assert_eq!(e(&eval("=SUMSQ(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_in_range_propagates() {
        let v = eval_with(&[("A1", 1.0.into())], "=SUMSQ(A1,1/0)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn overflow_num() {
        assert_eq!(e(&eval("=SUMSQ(1e308,1e308)")), CalcError::Num);
    }

    #[test]
    fn mixed_args() {
        let v = eval_with(&[("A1", 1.0.into()), ("A2", 2.0.into())], "=SUMSQ(A1:A2,3)");
        assert_eq!(n(&v), 14.0);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SUMSQ()")), CalcError::Value);
    }
}
