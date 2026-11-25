//! `FACT(number)` — factorial `n!`; `number` is truncated to an integer.
//! Spec: `docs/functions/FACT.md`.
//!
//! `FACT(171)` and beyond overflow to `#NUM!` (170! is the largest
//! representable factorial). A negative truncated argument is `#NUM!`
//! (SPEC-OPEN: `FACT(-0.9)` truncates to `-0` -> `1` here; Excel may error).

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
    let k = x.trunc();
    if k < 0.0 || k > 170.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let mut acc = 1.0f64;
    let mut i = 2.0;
    while i <= k {
        acc *= i;
        i += 1.0;
    }
    Ok(Value::Number(acc))
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
        assert_eq!(n(&eval("=FACT(5)")), 120.0);
        assert_eq!(n(&eval("=FACT(1.9)")), 1.0);
        assert_eq!(e(&eval("=FACT(-3)")), CalcError::Num);
    }

    #[test]
    fn zero_and_one() {
        assert_eq!(n(&eval("=FACT(0)")), 1.0);
        assert_eq!(n(&eval("=FACT(1)")), 1.0);
    }

    #[test]
    fn truncates() {
        assert_eq!(n(&eval("=FACT(3.9)")), 6.0);
        assert_eq!(n(&eval("=FACT(5.999)")), 120.0);
    }

    #[test]
    fn boundary_170() {
        assert_eq!(n(&eval("=FACT(170)")), 7.257415615307994e306);
        assert_eq!(e(&eval("=FACT(171)")), CalcError::Num);
        // 170.9 truncates to 170 -> still valid.
        assert_eq!(n(&eval("=FACT(170.9)")), 7.257415615307994e306);
    }

    #[test]
    fn fact_20() {
        assert_eq!(n(&eval("=FACT(20)")), 2.43290200817664e18);
    }

    #[test]
    fn negative_fraction() {
        // SPEC-OPEN: -0.9 truncates to -0 -> 0! = 1 (Excel may #NUM!).
        assert_eq!(n(&eval("=FACT(-0.9)")), 1.0);
    }

    #[test]
    fn text_coerces() {
        assert_eq!(n(&eval(r#"=FACT("4")"#)), 24.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=FACT("x")"#)), CalcError::Value);
    }

    #[test]
    fn boolean_coerces() {
        assert_eq!(n(&eval("=FACT(TRUE)")), 1.0);
        assert_eq!(n(&eval("=FACT(FALSE)")), 1.0);
    }

    #[test]
    fn blank_ref_is_one() {
        // Blank -> 0 -> 0! = 1.
        assert_eq!(n(&eval("=FACT(A1)")), 1.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=FACT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=FACT(1,2)")), CalcError::Value);
    }
}
