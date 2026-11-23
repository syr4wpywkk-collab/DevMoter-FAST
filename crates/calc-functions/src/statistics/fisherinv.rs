//! `FISHERINV(y)` — inverse Fisher transformation `tanh(y)`.
//! Spec: `docs/functions/FISHERINV.md`.
//!
//! Any real `y` is valid; the result saturates toward ±1 for large
//! |y|. Non-numeric input is `#VALUE!`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let y = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(y) => y,
    };
    Ok(Value::Number(y.tanh()))
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
    fn spec_example_roundtrip() {
        assert!((n(&eval("=FISHERINV(0.9729550745276566)")) - 0.75).abs() < 1e-14);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=FISHERINV(0)")), 0.0);
    }

    #[test]
    fn large_saturation() {
        assert!((n(&eval("=FISHERINV(10)")) - 0.9999999958776927).abs() < 1e-15);
    }

    #[test]
    fn negative() {
        assert!((n(&eval("=FISHERINV(-0.5)")) + 0.46211715726000974).abs() < 1e-15);
    }

    #[test]
    fn odd_symmetry() {
        let a = n(&eval("=FISHERINV(0.7)"));
        let b = n(&eval("=FISHERINV(-0.7)"));
        assert!((a + b).abs() < 1e-15);
    }

    #[test]
    fn huge_negative_saturates() {
        assert_eq!(n(&eval("=FISHERINV(-100)")), -1.0);
    }

    #[test]
    fn huge_positive_saturates() {
        assert_eq!(n(&eval("=FISHERINV(100)")), 1.0);
    }

    #[test]
    fn text_value_error() {
        assert_eq!(e(&eval(r#"=FISHERINV("a")"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert!((n(&eval(r#"=FISHERINV("0.5")"#)) - 0.46211715726000974).abs() < 1e-15);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 0.5.into())], "=FISHERINV(A1)");
        assert!((n(&v) - 0.46211715726000974).abs() < 1e-15);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Ref))], "=FISHERINV(A1)");
        assert_eq!(e(&v), CalcError::Ref);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=FISHERINV()")), CalcError::Value);
        assert_eq!(e(&eval("=FISHERINV(1,2)")), CalcError::Value);
    }
}
