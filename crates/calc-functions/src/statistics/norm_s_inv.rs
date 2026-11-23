//! `NORM.S.INV(probability)` — inverse standard normal CDF.
//! Spec: `docs/functions/NORM.S.INV.md`.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let p = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(p) => p,
    };
    if p <= 0.0 || p >= 1.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(numerics::normal_inv(p)))
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
    fn at_half() {
        assert_eq!(n(&eval("=NORM.S.INV(0.5)")), 0.0);
    }

    #[test]
    fn doc_example() {
        assert!((n(&eval("=NORM.S.INV(0.975)")) - 1.959963986120195).abs() < 1e-8);
    }

    #[test]
    fn doc_example_2() {
        assert!((n(&eval("=NORM.S.INV(0.908789)")) - 1.333333).abs() < 1e-5);
    }

    #[test]
    fn left_tail() {
        assert!((n(&eval("=NORM.S.INV(0.001)")) - (-3.0902323061678136)).abs() < 1e-9);
    }

    #[test]
    fn symmetry() {
        let a = n(&eval("=NORM.S.INV(0.03)"));
        let b = n(&eval("=NORM.S.INV(0.97)"));
        assert!((a + b).abs() < 1e-12);
    }

    #[test]
    fn round_trip() {
        assert!(
            (n(&eval("=NORM.S.DIST(NORM.S.INV(0.9772498680518208),TRUE)")) - 0.9772498680518208)
                .abs()
                < 1e-12
        );
    }

    #[test]
    fn p_zero_num() {
        assert_eq!(e(&eval("=NORM.S.INV(0)")), CalcError::Num);
    }

    #[test]
    fn p_one_num() {
        assert_eq!(e(&eval("=NORM.S.INV(1)")), CalcError::Num);
    }

    #[test]
    fn p_outside_num() {
        assert_eq!(e(&eval("=NORM.S.INV(-0.5)")), CalcError::Num);
        assert_eq!(e(&eval("=NORM.S.INV(1.5)")), CalcError::Num);
    }

    #[test]
    fn text_value() {
        assert_eq!(e(&eval("=NORM.S.INV(\"x\")")), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert_eq!(n(&eval("=NORM.S.INV(\"0.5\")")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=NORM.S.INV(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=NORM.S.INV()")), CalcError::Value);
        assert_eq!(e(&eval("=NORM.S.INV(0.5,1)")), CalcError::Value);
    }
}
