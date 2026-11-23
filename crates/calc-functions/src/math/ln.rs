//! `LN(number)` — natural logarithm. Spec: `docs/functions/LN.md`.
//!
//! `number <= 0` -> `#NUM!` (never a non-finite `f64` result).

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
    if x <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(x.ln()))
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
        assert!((n(&eval("=LN(10)")) - std::f64::consts::LN_10).abs() < 1e-14);
        assert_eq!(n(&eval("=LN(1)")), 0.0);
    }

    #[test]
    fn inverse_of_exp() {
        assert!((n(&eval("=LN(EXP(1))")) - 1.0).abs() < 1e-15);
        assert!((n(&eval("=LN(EXP(3.25))")) - 3.25).abs() < 1e-14);
    }

    #[test]
    fn ln_of_e() {
        assert!((n(&eval("=LN(2.718281828459045)")) - 1.0).abs() < 1e-15);
    }

    #[test]
    fn fractional() {
        assert!((n(&eval("=LN(0.5)")) - -std::f64::consts::LN_2).abs() < 1e-15);
    }

    #[test]
    fn zero_and_negative_num() {
        assert_eq!(e(&eval("=LN(0)")), CalcError::Num);
        assert_eq!(e(&eval("=LN(-5)")), CalcError::Num);
    }

    #[test]
    fn tiny_positive_finite() {
        let v = n(&eval("=LN(1E-300)"));
        assert!(v.is_finite() && v < -600.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=LN("1")"#)), 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=LN("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=LN(TRUE)")), 0.0);
        // FALSE -> 0 -> #NUM!.
        assert_eq!(e(&eval("=LN(FALSE)")), CalcError::Num);
    }

    #[test]
    fn blank_ref_num() {
        // Blank -> 0 -> #NUM!.
        assert_eq!(e(&eval("=LN(A1)")), CalcError::Num);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 10.0.into())], "=LN(A1)");
        assert!((n(&v) - std::f64::consts::LN_10).abs() < 1e-14);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=LN(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=LN(1,2)")), CalcError::Value);
    }
}
