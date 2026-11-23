//! `IMABS(inumber)` — modulus `|a+bi| = hypot(a, b)` of a complex
//! number. Spec: `docs/functions/IMABS.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::engineering::imaginary::eval_inumber;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match eval_inumber(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        // Complex::abs uses hypot, so 1e200-scale inputs stay finite
        // (spec "Engine requirements").
        Ok((z, _)) => Ok(Value::Number(z.abs())),
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
    fn spec_examples() {
        assert_eq!(n(&eval(r#"=IMABS("5+12i")"#)), 13.0);
        assert_eq!(n(&eval(r#"=IMABS("3-4j")"#)), 5.0);
        assert_eq!(n(&eval("=IMABS(-6)")), 6.0);
        assert_eq!(n(&eval(r#"=IMABS("4i")"#)), 4.0);
        assert_eq!(e(&eval(r#"=IMABS("2+ii")"#)), CalcError::Num);
    }

    #[test]
    fn unit_and_zero() {
        assert_eq!(n(&eval(r#"=IMABS("i")"#)), 1.0);
        assert_eq!(n(&eval(r#"=IMABS("0")"#)), 0.0);
    }

    #[test]
    fn fractional() {
        assert_eq!(n(&eval(r#"=IMABS("0.3+0.4i")"#)), 0.5);
    }

    #[test]
    fn hypot_no_overflow() {
        let v = n(&eval(r#"=IMABS("1e200+1e200i")"#));
        assert!((v - 2f64.sqrt() * 1e200).abs() < 1e190);
    }

    #[test]
    fn numeric_text_real() {
        assert_eq!(n(&eval(r#"=IMABS("-6")"#)), 6.0);
    }

    #[test]
    fn boolean_value_error() {
        assert_eq!(e(&eval("=IMABS(TRUE)")), CalcError::Value);
    }

    #[test]
    fn blank_ref_num() {
        // SPEC-OPEN: blank may coerce to 0+0i (=> 0) in Excel.
        assert_eq!(e(&eval("=IMABS(A1)")), CalcError::Num);
    }

    #[test]
    fn malformed_num() {
        assert_eq!(e(&eval(r#"=IMABS("xyz")"#)), CalcError::Num);
        assert_eq!(e(&eval(r#"=IMABS("3+4I")"#)), CalcError::Num);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=IMABS(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IMABS()")), CalcError::Value);
        assert_eq!(e(&eval(r#"=IMABS("1","2")"#)), CalcError::Value);
    }
}
