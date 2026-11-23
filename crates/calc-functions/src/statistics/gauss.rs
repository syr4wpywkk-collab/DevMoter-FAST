//! `GAUSS(z)` — `Φ(z) - 0.5`: the probability a standard normal falls
//! between 0 and `z`. Spec: `docs/functions/GAUSS.md`.
//!
//! Shares the `erfc`-based standard normal CDF in
//! [`crate::common::numerics`]; `GAUSS(-z) = -GAUSS(z)`.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let z = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(z) => z,
    };
    Ok(Value::Number(numerics::normal_cdf(z) - 0.5))
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
    fn spec_example_two() {
        assert!((n(&eval("=GAUSS(2)")) - 0.4772498680518208).abs() < 1e-14);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=GAUSS(0)")), 0.0);
    }

    #[test]
    fn negative_one() {
        assert!((n(&eval("=GAUSS(-1)")) + 0.3413447460685429).abs() < 1e-14);
    }

    #[test]
    fn odd_symmetry() {
        let a = n(&eval("=GAUSS(1.3)"));
        let b = n(&eval("=GAUSS(-1.3)"));
        assert!((a + b).abs() < 1e-15);
    }

    #[test]
    fn large_positive_saturates() {
        assert_eq!(n(&eval("=GAUSS(40)")), 0.5);
    }

    #[test]
    fn large_negative_saturates() {
        assert_eq!(n(&eval("=GAUSS(-40)")), -0.5);
    }

    #[test]
    fn text_value_error() {
        assert_eq!(e(&eval(r#"=GAUSS("a")"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert!((n(&eval(r#"=GAUSS("1")"#)) - 0.3413447460685429).abs() < 1e-14);
    }

    #[test]
    fn boolean_coerces() {
        assert!((n(&eval("=GAUSS(TRUE)")) - 0.3413447460685429).abs() < 1e-14);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 2.0.into())], "=GAUSS(A1)");
        assert!((n(&v) - 0.4772498680518208).abs() < 1e-14);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::DivZero))], "=GAUSS(A1)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=GAUSS()")), CalcError::Value);
        assert_eq!(e(&eval("=GAUSS(1,2)")), CalcError::Value);
    }
}
