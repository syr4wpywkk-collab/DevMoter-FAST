//! `ERF.PRECISE(x)` — error function `erf(x)` integrated from `0` to
//! `x`; the Excel 2010+ single-argument form of `ERF`.
//! Spec: `docs/functions/ERF.PRECISE.md`.
//! Kernel: [`crate::common::numerics::erf`], shared with `ERF`.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::numerics::erf;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    match ctx.eval(&args[0])?.to_number() {
        Ok(x) => Ok(Value::Number(erf(x))),
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
        a(&eval("=ERF.PRECISE(0.745)"), 0.7079289200957379);
        a(&eval("=ERF.PRECISE(1)"), 0.8427007929);
        assert_eq!(n(&eval("=ERF.PRECISE(0)")), 0.0);
        a(&eval("=ERF.PRECISE(-0.5)"), -0.5204998778);
    }

    #[test]
    fn matches_erf_single_arg() {
        a(&eval("=ERF.PRECISE(1.3)"), n(&eval("=ERF(1.3)")));
    }

    #[test]
    fn large_positive_saturates() {
        assert_eq!(n(&eval("=ERF.PRECISE(10)")), 1.0);
    }

    #[test]
    fn large_negative_saturates() {
        assert_eq!(n(&eval("=ERF.PRECISE(-10)")), -1.0);
    }

    #[test]
    fn text_coerces() {
        a(&eval(r#"=ERF.PRECISE("1")"#), 0.8427007929);
    }

    #[test]
    fn boolean_coerces() {
        a(&eval("=ERF.PRECISE(FALSE)"), 0.0);
    }

    #[test]
    fn blank_ref_zero() {
        assert_eq!(n(&eval("=ERF.PRECISE(A1)")), 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ERF.PRECISE("x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ERF.PRECISE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ERF.PRECISE()")), CalcError::Value);
        assert_eq!(e(&eval("=ERF.PRECISE(1,2)")), CalcError::Value);
    }
}
