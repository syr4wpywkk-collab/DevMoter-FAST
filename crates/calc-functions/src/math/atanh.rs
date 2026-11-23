//! `ATANH(number)` — inverse hyperbolic tangent of `number`.
//! Spec: `docs/functions/ATANH.md`.
//!
//! `ATANH(x) = 0.5 * LN((1+x)/(1-x))`; domain `-1 < x < 1` strict,
//! otherwise `#NUM!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if x.abs() >= 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(x.atanh()))
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
        assert!((n(&eval("=ATANH(0.5)")) - 0.5493061443340549).abs() < 1e-12);
        assert!((n(&eval("=ATANH(-0.1)")) + 0.10033534773107558).abs() < 1e-12);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=ATANH(0)")), 0.0);
    }

    #[test]
    fn near_one() {
        assert!((n(&eval("=ATANH(0.76159416)")) - 1.000000009).abs() < 1e-6);
    }

    #[test]
    fn endpoints_num_error() {
        assert_eq!(e(&eval("=ATANH(1)")), CalcError::Num);
        assert_eq!(e(&eval("=ATANH(-1)")), CalcError::Num);
    }

    #[test]
    fn out_of_domain() {
        assert_eq!(e(&eval("=ATANH(1.5)")), CalcError::Num);
        assert_eq!(e(&eval("=ATANH(-2)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert!((n(&eval(r#"=ATANH("0.5")"#)) - 0.5493061443340549).abs() < 1e-12);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ATANH("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=ATANH(FALSE)")), 0.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=ATANH(A1)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ATANH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ATANH(0.5,0.5)")), CalcError::Value);
    }
}
