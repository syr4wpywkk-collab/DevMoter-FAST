//! `FISHER(x)` — Fisher transformation `atanh(x) = 0.5·LN((1+x)/(1-x))`.
//! Spec: `docs/functions/FISHER.md`.
//!
//! Domain `-1 < x < 1`; the endpoints (and beyond) are `#NUM!`,
//! non-numeric input is `#VALUE!`.

use crate::common::coercion;
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
    if !(-1.0 < x && x < 1.0) {
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
    fn spec_example() {
        assert!((n(&eval("=FISHER(0.75)")) - 0.9729550745276566).abs() < 1e-14);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=FISHER(0)")), 0.0);
    }

    #[test]
    fn negative() {
        assert!((n(&eval("=FISHER(-0.5)")) + 0.5493061443340548).abs() < 1e-15);
    }

    #[test]
    fn boundary_one_num() {
        assert_eq!(e(&eval("=FISHER(1)")), CalcError::Num);
    }

    #[test]
    fn boundary_neg_one_num() {
        assert_eq!(e(&eval("=FISHER(-1)")), CalcError::Num);
    }

    #[test]
    fn out_of_domain() {
        assert_eq!(e(&eval("=FISHER(1.5)")), CalcError::Num);
        assert_eq!(e(&eval("=FISHER(-2)")), CalcError::Num);
    }

    #[test]
    fn text_value_error() {
        assert_eq!(e(&eval(r#"=FISHER("a")"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert!((n(&eval(r#"=FISHER("0.5")"#)) - 0.5493061443340548).abs() < 1e-15);
    }

    #[test]
    fn boolean_coerces() {
        // TRUE -> 1 -> out of domain -> #NUM!.
        assert_eq!(e(&eval("=FISHER(TRUE)")), CalcError::Num);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 0.75.into())], "=FISHER(A1)");
        assert!((n(&v) - 0.9729550745276566).abs() < 1e-14);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=FISHER(A1)");
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=FISHER()")), CalcError::Value);
        assert_eq!(e(&eval("=FISHER(0.5,0.5)")), CalcError::Value);
    }

    #[test]
    fn blank_cell_zero() {
        // Blank coerces to 0 -> atanh(0) = 0.
        assert_eq!(n(&eval("=FISHER(A1)")), 0.0);
    }
}
