//! `GAMMA(number)` — the gamma function `Γ(x)`.
//! Spec: `docs/functions/GAMMA.md`.
//!
//! Poles at `0` and the negative integers are `#NUM!`; results that
//! overflow `f64` (roughly `x > 171.6`) are `#NUM!` (Excel's documented
//! overflow behavior — see the spec's open question). Negative
//! non-integers are allowed via the reflection formula in
//! [`crate::common::numerics::gamma`].

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let x = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(x) => x,
    };
    let g = numerics::gamma(x);
    if !g.is_finite() {
        // NaN at the poles; ±inf on overflow -> #NUM!.
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(g))
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
    fn half_integer() {
        // GAMMA(2.5) = 1.5·√π/2
        assert!((n(&eval("=GAMMA(2.5)")) - 1.3293403881791372).abs() < 1e-14);
    }

    #[test]
    fn integer() {
        // Γ(5) = 4! = 24
        assert!((n(&eval("=GAMMA(5)")) - 24.0).abs() < 1e-12);
    }

    #[test]
    fn negative_non_integer() {
        // Reflection formula: Γ(-3.5) ≈ 0.2700882058522691
        assert!((n(&eval("=GAMMA(-3.5)")) - 0.2700882058522691).abs() < 1e-14);
    }

    #[test]
    fn zero_num() {
        assert_eq!(e(&eval("=GAMMA(0)")), CalcError::Num);
    }

    #[test]
    fn negative_integer_num() {
        assert_eq!(e(&eval("=GAMMA(-2)")), CalcError::Num);
        assert_eq!(e(&eval("=GAMMA(-10)")), CalcError::Num);
    }

    #[test]
    fn overflow_num() {
        // Γ overflows f64 near 171.6; Excel returns #NUM!.
        assert_eq!(e(&eval("=GAMMA(172)")), CalcError::Num);
        assert_eq!(e(&eval("=GAMMA(1000)")), CalcError::Num);
    }

    #[test]
    fn text_value_error() {
        assert_eq!(e(&eval(r#"=GAMMA("a")"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert!((n(&eval(r#"=GAMMA("5")"#)) - 24.0).abs() < 1e-12);
    }

    #[test]
    fn boolean_coerces() {
        // Γ(1) = 1.
        assert!((n(&eval("=GAMMA(TRUE)")) - 1.0).abs() < 1e-15);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 2.5.into())], "=GAMMA(A1)");
        assert!((n(&v) - 1.3293403881791372).abs() < 1e-14);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=GAMMA(A1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=GAMMA()")), CalcError::Value);
        assert_eq!(e(&eval("=GAMMA(1,2)")), CalcError::Value);
    }
}
