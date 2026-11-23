//! `COSH(number)` — hyperbolic cosine of `number`.
//! Spec: `docs/functions/COSH.md`.
//!
//! Overflow: a non-finite result maps to `#NUM!` (SPEC-OPEN — the spec
//! expects `#NUM!` on `COSH` overflow but the exact Excel cutoff is
//! unconfirmed; IEEE `cosh` overflows near `|x| ~ 710`).

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
    let r = x.cosh();
    if !r.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(r))
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
        assert!((n(&eval("=COSH(4)")) - 27.308232836016487).abs() < 1e-12);
        assert!((n(&eval("=COSH(-1)")) - 1.5430806348152437).abs() < 1e-12);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=COSH(0)")), 1.0);
    }

    #[test]
    fn even_function() {
        assert_eq!(n(&eval("=COSH(3)")), n(&eval("=COSH(-3)")));
    }

    #[test]
    fn result_at_least_one() {
        assert!(n(&eval("=COSH(0.001)")) >= 1.0);
    }

    #[test]
    fn overflow_num_error() {
        assert_eq!(e(&eval("=COSH(1000)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=COSH("0")"#)), 1.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=COSH("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=COSH(FALSE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=COSH(A1)")), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=COSH(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=COSH(1,2)")), CalcError::Value);
    }
}
