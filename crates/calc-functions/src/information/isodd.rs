//! `ISODD(number)` — TRUE when `number` is odd. Non-integers are
//! truncated toward zero before the parity test. Same coercion and
//! error rules as `ISEVEN`. Spec: `docs/functions/ISODD.md`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::coercion::eval_number;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match eval_number(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(n) => Ok(Value::Boolean(n.trunc() % 2.0 != 0.0)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn b(v: &Value) -> bool {
        match v {
            Value::Boolean(b) => *b,
            o => panic!("expected bool, got {o:?}"),
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
        assert!(b(&eval("=ISODD(3)")));
        assert!(!b(&eval("=ISODD(4)")));
        assert!(!b(&eval("=ISODD(-2.5)")));
        assert!(!b(&eval(r#"=ISODD("4")"#)));
    }

    #[test]
    fn truncation_not_rounding() {
        assert!(b(&eval("=ISODD(3.9)")));
        assert!(b(&eval("=ISODD(-3.9)")));
        assert!(!b(&eval("=ISODD(2.5)")));
        assert!(!b(&eval("=ISODD(2.9)")));
    }

    #[test]
    fn negative_odd() {
        assert!(b(&eval("=ISODD(-3)")));
        assert!(b(&eval("=ISODD(-5)")));
        assert!(!b(&eval("=ISODD(-4)")));
    }

    #[test]
    fn zero_false() {
        assert!(!b(&eval("=ISODD(0)")));
    }

    #[test]
    fn text_coercion() {
        assert!(b(&eval(r#"=ISODD("3")"#)));
        assert_eq!(e(&eval(r#"=ISODD("three")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coercion() {
        assert!(b(&eval("=ISODD(TRUE)"))); // 1 -> odd
        assert!(!b(&eval("=ISODD(FALSE)"))); // 0 -> even
    }

    #[test]
    fn blank_cell_is_zero() {
        assert!(!b(&eval("=ISODD(A1)")));
    }

    #[test]
    fn number_cell() {
        assert!(b(&eval_with(&[("A1", 7.0.into())], "=ISODD(A1)")));
        assert!(!b(&eval_with(&[("A1", 8.0.into())], "=ISODD(A1)")));
    }

    #[test]
    fn inverse_of_iseven() {
        for f in ["=ISODD(5)", "=ISODD(6)", "=ISODD(-7)", "=ISODD(0)"] {
            let even = f.replacen("ISODD", "ISEVEN", 1);
            assert_eq!(b(&eval(f)), !b(&eval(&even)), "{f}");
        }
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ISODD(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=ISODD(NA())")), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISODD()")), CalcError::Value);
        assert_eq!(e(&eval("=ISODD(1,2)")), CalcError::Value);
    }
}
