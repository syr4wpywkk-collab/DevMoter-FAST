//! `INT(number)` — round down toward negative infinity.
//! Spec: `docs/functions/INT.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match ctx.eval(&args[0])?.to_number() {
        Ok(x) => Ok(Value::Number(x.floor())),
        Err(e) => Ok(Value::Error(e)),
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
    fn positive_down() {
        assert_eq!(n(&eval("=INT(8.9)")), 8.0);
        assert_eq!(n(&eval("=INT(8.1)")), 8.0);
    }

    #[test]
    fn negative_toward_neg_inf() {
        // Differs from TRUNC: INT(-8.9) -> -9.
        assert_eq!(n(&eval("=INT(-8.9)")), -9.0);
        assert_eq!(n(&eval("=INT(-8.1)")), -9.0);
    }

    #[test]
    fn already_integer() {
        assert_eq!(n(&eval("=INT(-8)")), -8.0);
        assert_eq!(n(&eval("=INT(8)")), 8.0);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=INT(0)")), 0.0);
        assert_eq!(n(&eval("=INT(-0.5)")), -1.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=INT("3.7")"#)), 3.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=INT("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=INT(TRUE)")), 1.0);
        assert_eq!(n(&eval("=INT(FALSE)")), 0.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=INT(A1)")), 0.0);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", (-2.5).into())], "=INT(A1)");
        assert_eq!(n(&v), -3.0);
    }

    #[test]
    fn large_magnitude() {
        // Beyond int64: still an f64 result, no range error.
        assert_eq!(n(&eval("=INT(1.5E19)")), 1.5e19);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=INT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=INT(1,2)")), CalcError::Value);
    }
}
