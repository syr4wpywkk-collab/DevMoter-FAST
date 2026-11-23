//! `ISEVEN(number)` — TRUE when `number` is even. Non-integers are
//! truncated toward zero before the parity test. Standard direct-arg
//! numeric coercion applies (`"4"` -> 4, `TRUE` -> 1, blank -> 0);
//! non-numeric text is `#VALUE!`. Spec: `docs/functions/ISEVEN.md`.

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
        Ok(n) => Ok(Value::Boolean(n.trunc() % 2.0 == 0.0)),
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
        assert!(b(&eval("=ISEVEN(4)")));
        assert!(!b(&eval("=ISEVEN(3)")));
        assert!(b(&eval("=ISEVEN(-2.5)")));
        assert_eq!(e(&eval(r#"=ISEVEN("six")"#)), CalcError::Value);
    }

    #[test]
    fn truncation_not_rounding() {
        assert!(b(&eval("=ISEVEN(2.9)")));
        assert!(b(&eval("=ISEVEN(2.5)")));
        assert!(b(&eval("=ISEVEN(4.99999)")));
        assert!(b(&eval("=ISEVEN(-2.9)")));
        assert!(!b(&eval("=ISEVEN(3.1)")));
    }

    #[test]
    fn negative_even() {
        assert!(b(&eval("=ISEVEN(-4)")));
        assert!(b(&eval("=ISEVEN(-2)")));
        assert!(!b(&eval("=ISEVEN(-3)")));
    }

    #[test]
    fn zero_true() {
        assert!(b(&eval("=ISEVEN(0)")));
    }

    #[test]
    fn text_coercion() {
        assert!(b(&eval(r#"=ISEVEN("4")"#)));
        assert!(!b(&eval(r#"=ISEVEN("3")"#)));
    }

    #[test]
    fn boolean_coercion() {
        assert!(!b(&eval("=ISEVEN(TRUE)"))); // 1 -> odd
        assert!(b(&eval("=ISEVEN(FALSE)"))); // 0 -> even
    }

    #[test]
    fn blank_cell_is_zero() {
        assert!(b(&eval("=ISEVEN(A1)")));
    }

    #[test]
    fn number_cell() {
        assert!(b(&eval_with(&[("A1", 8.0.into())], "=ISEVEN(A1)")));
        assert!(!b(&eval_with(&[("A1", 7.0.into())], "=ISEVEN(A1)")));
    }

    #[test]
    fn fractional_cell() {
        assert!(b(&eval_with(&[("A1", 6.7.into())], "=ISEVEN(A1)")));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ISEVEN(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=ISEVEN(NA())")), CalcError::NA);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISEVEN()")), CalcError::Value);
        assert_eq!(e(&eval("=ISEVEN(1,2)")), CalcError::Value);
    }
}
