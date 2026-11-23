//! `ERF(lower_limit, [upper_limit])` — Gauss error function integrated
//! between the limits. One argument integrates `0..lower`.
//! Spec: `docs/functions/ERF.md`.
//! Kernel: [`crate::common::numerics::erf`] (~1e-15).

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::numerics::erf;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let lo = match ctx.eval(&args[0])?.to_number() {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let out = if args.len() == 2 {
        let hi = match ctx.eval(&args[1])?.to_number() {
            Ok(v) => v,
            Err(e) => return Ok(Value::Error(e)),
        };
        erf(hi) - erf(lo)
    } else {
        erf(lo)
    };
    // Non-finite inputs saturate erf at ±1, so `out` is always finite.
    Ok(Value::Number(out))
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
        a(&eval("=ERF(0.745)"), 0.7079289200957379);
        a(&eval("=ERF(1)"), 0.8427007929);
        a(&eval("=ERF(0,1)"), 0.8427007929);
        a(&eval("=ERF(1,2)"), 0.1526214720);
        a(&eval("=ERF(-1)"), -0.8427007929);
    }

    #[test]
    fn zero_is_zero() {
        assert_eq!(n(&eval("=ERF(0)")), 0.0);
    }

    #[test]
    fn odd_symmetry() {
        a(&eval("=ERF(-0.5)"), -0.5204998778);
    }

    #[test]
    fn two_args_difference() {
        // erf(upper)-erf(lower); negative window is negative.
        a(&eval("=ERF(2,1)"), -0.1526214720);
        a(&eval("=ERF(-1,1)"), 2.0 * 0.8427007929);
    }

    #[test]
    fn same_limits_zero() {
        assert_eq!(n(&eval("=ERF(3,3)")), 0.0);
    }

    #[test]
    fn text_coerces() {
        a(&eval(r#"=ERF("1")"#), 0.8427007929);
        a(&eval(r#"=ERF("0","1")"#), 0.8427007929);
    }

    #[test]
    fn boolean_coerces() {
        a(&eval("=ERF(TRUE)"), 0.8427007929);
    }

    #[test]
    fn blank_ref_zero() {
        assert_eq!(n(&eval("=ERF(A1)")), 0.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ERF("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=ERF(1,"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ERF(1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=ERF(0,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ERF()")), CalcError::Value);
        assert_eq!(e(&eval("=ERF(1,2,3)")), CalcError::Value);
    }
}
