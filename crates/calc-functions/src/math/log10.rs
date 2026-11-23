//! `LOG10(number)` — base-10 logarithm. Spec: `docs/functions/LOG10.md`.
//!
//! Implemented via `f64::log10` (SPEC-OPEN: vs `ln/ln(10)` — `log10`
//! returns exact integers for representable powers of 10).
//! `number <= 0` -> `#NUM!`.

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
    Ok(Value::Number(x.log10()))
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
        assert_eq!(n(&eval("=LOG10(10)")), 1.0);
        assert_eq!(n(&eval("=LOG10(100)")), 2.0);
        assert_eq!(n(&eval("=LOG10(1)")), 0.0);
        assert!((n(&eval("=LOG10(86)")) - 1.9344984512435675).abs() < 1e-14);
    }

    #[test]
    fn powers_of_ten_exact() {
        assert_eq!(n(&eval("=LOG10(1000)")), 3.0);
        assert_eq!(n(&eval("=LOG10(1E-3)")), -3.0);
    }

    #[test]
    fn equivalent_to_log_base10() {
        // Same value within 1 ulp-level noise: LOG computes ln/ln
        // while LOG10 uses f64::log10 directly.
        assert!((n(&eval("=LOG10(5)")) - n(&eval("=LOG(5,10)"))).abs() < 1e-15);
        assert!((n(&eval("=LOG10(5)")) - n(&eval("=LOG(5)"))).abs() < 1e-15);
    }

    #[test]
    fn fractional() {
        assert!((n(&eval("=LOG10(2)")) - std::f64::consts::LOG10_2).abs() < 1e-15);
    }

    #[test]
    fn zero_and_negative_num() {
        assert_eq!(e(&eval("=LOG10(0)")), CalcError::Num);
        assert_eq!(e(&eval("=LOG10(-10)")), CalcError::Num);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=LOG10("1000")"#)), 3.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=LOG10("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=LOG10(TRUE)")), 0.0);
        assert_eq!(e(&eval("=LOG10(FALSE)")), CalcError::Num);
    }

    #[test]
    fn blank_ref_num() {
        assert_eq!(e(&eval("=LOG10(A1)")), CalcError::Num);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 1000.0.into())], "=LOG10(A1)");
        assert_eq!(n(&v), 3.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=LOG10(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=LOG10(1,2)")), CalcError::Value);
    }
}
