//! `FLOOR(number, significance)` — legacy floor to a multiple of
//! `significance`. Spec: `docs/functions/FLOOR.md`.
//!
//! Classic Excel semantics implemented here: `number` and `significance`
//! must share a sign (mismatched signs -> `#NUM!`) and the rounding is
//! toward zero. SPEC-OPEN: modern Excel 365 accepts mixed signs and rounds
//! toward -inf; the version split is unresolved. `significance = 0`
//! returns `0` (SPEC-OPEN, mirrors `FLOOR.MATH`).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let sig = match ctx.eval(&args[1])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if sig == 0.0 {
        return Ok(Value::Number(0.0));
    }
    if (x > 0.0 && sig < 0.0) || (x < 0.0 && sig > 0.0) {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(floor_toward_zero(x, sig.abs())))
}

/// Rounds `x` toward zero to a multiple of positive `sig`, with the same
/// near-exact epsilon guard as `common::number::round_to_significance`.
fn floor_toward_zero(x: f64, sig: f64) -> f64 {
    let q = x.abs() / sig;
    let nearest = q.round();
    if (q - nearest).abs() <= nearest.abs().max(1.0) * 1e-12 {
        return x;
    }
    q.floor() * sig * x.signum()
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
    fn spec_examples() {
        assert_eq!(n(&eval("=FLOOR(3.7,2)")), 2.0);
        assert_eq!(n(&eval("=FLOOR(1.5,0.1)")), 1.5);
        assert_eq!(n(&eval("=FLOOR(0.234,0.01)")), 0.23);
    }

    #[test]
    fn negative_toward_zero() {
        // Classic semantics: matching negative sign rounds toward zero.
        assert_eq!(n(&eval("=FLOOR(-2.5,-2)")), -2.0);
        assert_eq!(n(&eval("=FLOOR(-3.7,-2)")), -2.0);
    }

    #[test]
    fn mismatched_signs_num() {
        // Classic semantics; modern Excel may round toward -inf instead
        // (SPEC-OPEN version split).
        assert_eq!(e(&eval("=FLOOR(-2.5,2)")), CalcError::Num);
        assert_eq!(e(&eval("=FLOOR(2.5,-2)")), CalcError::Num);
    }

    #[test]
    fn exact_multiple() {
        assert_eq!(n(&eval("=FLOOR(6,3)")), 6.0);
        assert!((n(&eval("=FLOOR(0.3,0.1)")) - 0.3).abs() < 1e-12);
    }

    #[test]
    fn zero_significance() {
        // SPEC-OPEN: legacy FLOOR may return #DIV/0!/#NUM! instead.
        assert_eq!(n(&eval("=FLOOR(4.3,0)")), 0.0);
    }

    #[test]
    fn zero_input() {
        assert_eq!(n(&eval("=FLOOR(0,5)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=FLOOR("3.7","2")"#)), 2.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=FLOOR("x",2)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=FLOOR(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=FLOOR(TRUE,TRUE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=FLOOR(A1,2)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=FLOOR(1/0,2)")), CalcError::DivZero);
        assert_eq!(e(&eval("=FLOOR(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=FLOOR(1)")), CalcError::Value);
        assert_eq!(e(&eval("=FLOOR(1,2,3)")), CalcError::Value);
    }
}
