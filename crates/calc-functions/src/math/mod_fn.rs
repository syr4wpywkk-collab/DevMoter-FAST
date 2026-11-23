//! `MOD(number, divisor)` — remainder after division, sign of `divisor`.
//! Spec: `docs/functions/MOD.md`.
//!
//! Implemented as `n - d * floor(n / d)` (never raw `%`, v2 §2) so the
//! result always carries the divisor's sign.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let n = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let d = match ctx.eval(&args[1])?.to_number() {
        Ok(d) => d,
        Err(e) => return Ok(Value::Error(e)),
    };
    if d == 0.0 {
        return Ok(Value::Error(CalcError::DivZero));
    }
    Ok(Value::Number(crate::common::number::fmod_excel(n, d)))
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
    fn basic() {
        assert_eq!(n(&eval("=MOD(3,2)")), 1.0);
        assert_eq!(n(&eval("=MOD(7,3)")), 1.0);
    }

    #[test]
    fn sign_follows_divisor() {
        assert_eq!(n(&eval("=MOD(-3,2)")), 1.0);
        assert_eq!(n(&eval("=MOD(3,-2)")), -1.0);
        assert_eq!(n(&eval("=MOD(-3,-2)")), -1.0);
    }

    #[test]
    fn fractional() {
        assert_eq!(n(&eval("=MOD(5.5,2)")), 1.5);
        assert_eq!(n(&eval("=MOD(-5.5,2)")), 0.5);
    }

    #[test]
    fn zero_number() {
        assert_eq!(n(&eval("=MOD(0,5)")), 0.0);
        assert_eq!(n(&eval("=MOD(0,-5)")), 0.0);
    }

    #[test]
    fn exact_multiple() {
        assert_eq!(n(&eval("=MOD(6,3)")), 0.0);
    }

    #[test]
    fn divisor_zero() {
        assert_eq!(e(&eval("=MOD(3,0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=MOD(-3,0)")), CalcError::DivZero);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=MOD("-7","3")"#)), 2.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=MOD("x",2)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=MOD(2,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=MOD(5,TRUE)")), 0.0);
        assert_eq!(e(&eval("=MOD(5,FALSE)")), CalcError::DivZero);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=MOD(A1,3)")), 0.0);
        assert_eq!(e(&eval("=MOD(3,A1)")), CalcError::DivZero);
    }

    #[test]
    fn cell_refs() {
        let v = eval_with(&[("A1", 10.0.into()), ("B1", (-4.0).into())], "=MOD(A1,B1)");
        assert_eq!(n(&v), -2.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MOD(1/0,2)")), CalcError::DivZero);
        assert_eq!(e(&eval("=MOD(2,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MOD(1)")), CalcError::Value);
        assert_eq!(e(&eval("=MOD(1,2,3)")), CalcError::Value);
    }
}
