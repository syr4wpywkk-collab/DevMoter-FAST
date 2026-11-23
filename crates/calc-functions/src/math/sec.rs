//! `SEC(number)` — secant of an angle in radians, `1/cos(number)`.
//! Spec: `docs/functions/SEC.md` (Excel 2013+).
//!
//! `cos` never hits exactly 0 at `PI()/2` in f64, so results are huge
//! but finite — no error. SPEC-OPEN: large-argument domain policy
//! (|x| >= 2^27 in LibreOffice) shared with `SIN`/`TAN`.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match coercion::eval_number(ctx, &args[0])? {
        Err(e) => Ok(Value::Error(e)),
        Ok(x) => Ok(Value::Number(1.0 / x.cos())),
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
    fn sec_zero() {
        assert_eq!(n(&eval("=SEC(0)")), 1.0);
    }

    #[test]
    fn sec_45_deg() {
        assert!((n(&eval("=SEC(45*PI()/180)")) - 2.0f64.sqrt()).abs() < 1e-14);
    }

    #[test]
    fn sec_two() {
        assert!((n(&eval("=SEC(2)")) + 2.402997961722381).abs() < 1e-13);
    }

    #[test]
    fn sec_pi() {
        assert_eq!(n(&eval("=SEC(PI())")), -1.0);
    }

    #[test]
    fn sec_60_deg() {
        assert!((n(&eval("=SEC(60*PI()/180)")) - 2.0).abs() < 1e-14);
    }

    #[test]
    fn sec_near_half_pi_finite() {
        let v = n(&eval("=SEC(PI()/2)"));
        assert!(v.is_finite() && v.abs() > 1e10);
    }

    #[test]
    fn sec_even_about_zero() {
        assert_eq!(n(&eval("=SEC(-1)")), n(&eval("=SEC(1)")));
    }

    #[test]
    fn text_coercion() {
        assert_eq!(n(&eval("=SEC(\"0\")")), 1.0);
    }

    #[test]
    fn bad_text() {
        assert_eq!(e(&eval("=SEC(\"x\")")), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=SEC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SEC()")), CalcError::Value);
        assert_eq!(e(&eval("=SEC(1,2)")), CalcError::Value);
    }
}
