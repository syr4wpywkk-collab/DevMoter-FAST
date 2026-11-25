//! `EFFECT(nominal_rate, npery)` — effective annual rate:
//! `(1 + nominal_rate/npery)^npery - 1`. Spec:
//! `docs/functions/EFFECT.md`.
//!
//! `npery` truncates to an integer `>= 1`; `nominal_rate <= 0` is
//! `#NUM!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_serial;

use super::number_arg;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let nominal = match number_arg(ctx, args, 0)? {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let npery = match number_arg(ctx, args, 1)? {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let n = date_serial::trunc_to_i64(npery);
    if nominal <= 0.0 || n < 1 {
        return Ok(Value::Error(CalcError::Num));
    }
    let n = n as f64;
    Ok(Value::Number((1.0 + nominal / n).powf(n) - 1.0))
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
        assert!((n(&eval("=EFFECT(0.0525,4)")) - 0.053542667).abs() < 1e-7);
        assert!((n(&eval("=EFFECT(0.05,12)")) - 0.051161898).abs() < 1e-7);
        assert!((n(&eval("=EFFECT(0.1,1)")) - 0.1).abs() < 1e-15);
        // npery truncates: 4.9 -> 4.
        assert_eq!(
            n(&eval("=EFFECT(0.0525,4.9)")),
            n(&eval("=EFFECT(0.0525,4)"))
        );
        assert_eq!(e(&eval("=EFFECT(0,4)")), CalcError::Num);
    }

    #[test]
    fn negative_rate_num() {
        assert_eq!(e(&eval("=EFFECT(-0.05,4)")), CalcError::Num);
    }

    #[test]
    fn npery_below_one_num() {
        assert_eq!(e(&eval("=EFFECT(0.05,0)")), CalcError::Num);
        // 0.9 truncates to 0 -> #NUM!.
        assert_eq!(e(&eval("=EFFECT(0.05,0.9)")), CalcError::Num);
        assert_eq!(e(&eval("=EFFECT(0.05,-2)")), CalcError::Num);
    }

    #[test]
    fn continuous_limit() {
        // Large npery approaches exp(r)-1.
        let v = n(&eval("=EFFECT(0.05,1000000)"));
        assert!((v - (0.05f64.exp() - 1.0)).abs() < 1e-6);
    }

    #[test]
    fn unit_rate() {
        assert_eq!(n(&eval("=EFFECT(1,1)")), 1.0);
    }

    #[test]
    fn text_number_coerces() {
        assert!((n(&eval(r#"=EFFECT("0.0525","4")"#)) - 0.053542667).abs() < 1e-7);
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(e(&eval(r#"=EFFECT("x",4)"#)), CalcError::Value);
    }

    #[test]
    fn blank_is_zero_num() {
        assert_eq!(e(&eval("=EFFECT(,4)")), CalcError::Num);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=EFFECT(TRUE,1)")), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=EFFECT(1/0,4)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=EFFECT(1)")), CalcError::Value);
        assert_eq!(e(&eval("=EFFECT(1,2,3)")), CalcError::Value);
    }
}
