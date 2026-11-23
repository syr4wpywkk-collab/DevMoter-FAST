//! `ERFC.PRECISE(x)` — complementary error function `1 - erf(x)`; the
//! Excel 2010+ spelling of `ERFC`.
//! Spec: `docs/functions/ERFC.PRECISE.md`.
//! Kernel: [`crate::common::numerics::erfc`], shared with `ERFC`.

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
        a(&eval("=ERFC.PRECISE(1)"), 0.1572992071);
        assert_eq!(n(&eval("=ERFC.PRECISE(0)")), 1.0);
        a(&eval("=ERFC.PRECISE(2)"), 0.0046777350);
    }

    #[test]
    fn matches_erfc() {
        a(&eval("=ERFC.PRECISE(1.7)"), n(&eval("=ERFC(1.7)")));
    }

    #[test]
    fn negative_arg() {
        a(&eval("=ERFC.PRECISE(-1)"), 1.8427007929);
    }

    #[test]
    fn right_tail_no_cancellation() {
        let v = n(&eval("=ERFC.PRECISE(27)"));
        assert!(v > 0.0 && v < 1e-150, "got {v}");
    }

    #[test]
    fn text_coerces() {
        a(&eval(r#"=ERFC.PRECISE("0.5")"#), 0.4795001222);
    }

    #[test]
    fn blank_ref_zero() {
        assert_eq!(n(&eval("=ERFC.PRECISE(A1)")), 1.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ERFC.PRECISE("x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ERFC.PRECISE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ERFC.PRECISE()")), CalcError::Value);
        assert_eq!(e(&eval("=ERFC.PRECISE(1,2)")), CalcError::Value);
    }
}
