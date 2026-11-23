//! `MROUND(number, multiple)` — rounds `number` to the nearest multiple
//! of `multiple`, halves away from zero. Spec: `docs/functions/MROUND.md`.
//!
//! Differing signs -> `#NUM!`; `multiple = 0` -> `0` (documented Excel
//! behavior; SPEC-OPEN notes the `#DIV/0!` alternative).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let m = match ctx.eval(&args[1])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    if m == 0.0 {
        return Ok(Value::Number(0.0));
    }
    if x != 0.0 && x.signum() != m.signum() {
        return Ok(Value::Error(CalcError::Num));
    }
    // f64::round is half away from zero, matching Excel's rule.
    Ok(Value::Number(m * (x / m).round()))
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
        assert_eq!(n(&eval("=MROUND(10,3)")), 9.0);
        assert_eq!(n(&eval("=MROUND(-10,-3)")), -9.0);
        assert!((n(&eval("=MROUND(1.3,0.2)")) - 1.4).abs() < 1e-12);
    }

    #[test]
    fn halves_away_from_zero() {
        assert_eq!(n(&eval("=MROUND(5,2)")), 6.0);
        assert_eq!(n(&eval("=MROUND(-5,-2)")), -6.0);
        assert_eq!(n(&eval("=MROUND(2.5,1)")), 3.0);
    }

    #[test]
    fn sign_mismatch_num() {
        assert_eq!(e(&eval("=MROUND(-10,3)")), CalcError::Num);
        assert_eq!(e(&eval("=MROUND(10,-3)")), CalcError::Num);
    }

    #[test]
    fn zero_multiple() {
        // SPEC-OPEN: documented 0; alternative #DIV/0!.
        assert_eq!(n(&eval("=MROUND(10,0)")), 0.0);
    }

    #[test]
    fn zero_number() {
        assert_eq!(n(&eval("=MROUND(0,5)")), 0.0);
        assert_eq!(n(&eval("=MROUND(0,-5)")), 0.0);
    }

    #[test]
    fn fractional_multiple() {
        assert!((n(&eval("=MROUND(1.25,0.5)")) - 1.5).abs() < 1e-12);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=MROUND("10","3")"#)), 9.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=MROUND("x",3)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=MROUND(10,"x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=MROUND(TRUE,TRUE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_zero() {
        assert_eq!(n(&eval("=MROUND(A1,3)")), 0.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=MROUND(1/0,3)")), CalcError::DivZero);
        assert_eq!(e(&eval("=MROUND(10,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MROUND(1)")), CalcError::Value);
        assert_eq!(e(&eval("=MROUND(1,2,3)")), CalcError::Value);
    }
}
