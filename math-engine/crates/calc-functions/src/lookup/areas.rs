//! `AREAS(reference)` — the number of contiguous areas in a reference.
//! Spec: `docs/functions/AREAS.md`.
//!
//! The engine has no union operator (ADR 0002 defers multi-area
//! references), so every valid reference argument is single-area and
//! the result is `1`; union syntax `AREAS((A1:B2,C3:D4))` fails at
//! parse time before this function runs. Non-reference arguments are
//! `#VALUE!` (Excel's argument-type error).

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match ctx.eval_ref(&args[0])? {
        Ok(_) => Ok(Value::Number(1.0)),
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
    fn single_cell_is_one_area() {
        assert_eq!(n(&eval("=AREAS(A1)")), 1.0);
    }

    #[test]
    fn single_range_is_one_area() {
        assert_eq!(n(&eval("=AREAS(B2:D4)")), 1.0);
    }

    #[test]
    fn reference_returning_function_counts() {
        // OFFSET returns a single-area reference.
        assert_eq!(n(&eval("=AREAS(OFFSET(A1,1,1,2,2))")), 1.0);
    }

    #[test]
    fn indirect_counts_as_reference() {
        assert_eq!(n(&eval(r#"=AREAS(INDIRECT("A1:B2"))"#)), 1.0);
    }

    #[test]
    fn text_is_not_a_reference() {
        assert_eq!(e(&eval(r#"=AREAS("A1:B2")"#)), CalcError::Value);
    }

    #[test]
    fn number_is_not_a_reference() {
        assert_eq!(e(&eval("=AREAS(3)")), CalcError::Value);
    }

    #[test]
    fn missing_sheet_reference() {
        assert_eq!(e(&eval("=AREAS(NoSheet!A1)")), CalcError::Ref);
    }

    #[test]
    fn error_argument_propagates() {
        assert_eq!(e(&eval("=AREAS(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=AREAS(#REF!)")), CalcError::Ref);
    }

    #[test]
    fn boolean_is_not_a_reference() {
        assert_eq!(e(&eval("=AREAS(TRUE)")), CalcError::Value);
    }

    #[test]
    fn array_literal_is_not_a_reference() {
        assert_eq!(e(&eval("=AREAS({1,2})")), CalcError::Value);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=AREAS()")), CalcError::Value);
        assert_eq!(e(&eval("=AREAS(A1,A2)")), CalcError::Value);
    }
}
