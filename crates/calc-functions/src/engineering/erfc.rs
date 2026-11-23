//! `ERFC(x)` — complementary error function `1 - erf(x)`, computed
//! directly (not by subtraction) so the right tail keeps precision.
//! Spec: `docs/functions/ERFC.md`.
//! Kernel: [`crate::common::numerics::erfc`].

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::numerics::erfc;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match ctx.eval(&args[0])?.to_number() {
        Ok(x) => Ok(Value::Number(erfc(x))),
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

    fn a(v: &Value, x: f64) {
        let got = n(v);
        assert!(
            (got - x).abs() <= 1e-9 * x.abs().max(1.0),
            "got {got}, want {x}"
        );
    }

    #[test]
    fn spec_examples() {
        a(&eval("=ERFC(1)"), 0.1572992071);
        assert_eq!(n(&eval("=ERFC(0)")), 1.0);
        a(&eval("=ERFC(0.5)"), 0.4795001222);
        a(&eval("=ERFC(-1)"), 1.8427007929);
    }

    #[test]
    fn right_tail_no_cancellation() {
        // erfc(27) ≈ 5.2e-157; 1 - erf(27) would collapse to 0.
        let v = n(&eval("=ERFC(27)"));
        assert!(v > 0.0 && v < 1e-150, "got {v}");
    }

    #[test]
    fn far_negative_saturates() {
        assert_eq!(n(&eval("=ERFC(-10)")), 2.0);
    }

    #[test]
    fn text_coerces() {
        a(&eval(r#"=ERFC("1")"#), 0.1572992071);
    }

    #[test]
    fn boolean_coerces() {
        a(&eval("=ERFC(TRUE)"), 0.1572992071);
    }

    #[test]
    fn blank_ref_zero() {
        assert_eq!(n(&eval("=ERFC(A1)")), 1.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ERFC("x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ERFC(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ERFC()")), CalcError::Value);
        assert_eq!(e(&eval("=ERFC(1,2)")), CalcError::Value);
    }
}
