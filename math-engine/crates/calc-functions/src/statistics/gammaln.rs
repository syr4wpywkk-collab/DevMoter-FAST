//! `GAMMALN(x)` — natural log of `|Γ(x)|`, for `x > 0`.
//! Spec: `docs/functions/GAMMALN.md`.
//!
//! `x <= 0` -> `#NUM!` (per Excel docs, even where `Γ` is positive for
//! negative non-integers); non-numeric -> `#VALUE!`. Kernel is the
//! Lanczos `ln_gamma` in [`crate::common::numerics`]; shared with
//! `GAMMALN.PRECISE`.

use crate::common::{coercion, numerics};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let x = match coercion::eval_number(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(x) => x,
    };
    let g = numerics::ln_gamma(x);
    if g.is_nan() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(g))
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
    fn spec_example_ln6() {
        assert!((n(&eval("=GAMMALN(4)")) - 1.791759469228055).abs() < 1e-14);
    }

    #[test]
    fn spec_example_ln_sqrt_pi() {
        assert!((n(&eval("=GAMMALN(0.5)")) - 0.5723649429247001).abs() < 1e-14);
    }

    #[test]
    fn spec_example_ln_9factorial() {
        assert!((n(&eval("=GAMMALN(10)")) - 12.801827480081469).abs() < 1e-13);
    }

    #[test]
    fn one_and_two_are_zero() {
        assert!(n(&eval("=GAMMALN(1)")).abs() < 1e-14);
        assert!(n(&eval("=GAMMALN(2)")).abs() < 1e-14);
    }

    #[test]
    fn zero_num() {
        assert_eq!(e(&eval("=GAMMALN(0)")), CalcError::Num);
    }

    #[test]
    fn negative_num() {
        // Per spec: all x <= 0 error, even -0.5 where Γ > 0.
        assert_eq!(e(&eval("=GAMMALN(-1)")), CalcError::Num);
        assert_eq!(e(&eval("=GAMMALN(-0.5)")), CalcError::Num);
    }

    #[test]
    fn text_value_error() {
        assert_eq!(e(&eval(r#"=GAMMALN("a")"#)), CalcError::Value);
    }

    #[test]
    fn numeric_text_coerces() {
        assert!((n(&eval(r#"=GAMMALN("4")"#)) - 1.791759469228055).abs() < 1e-14);
    }

    #[test]
    fn cell_ref() {
        let v = eval_with(&[("A1", 4.0.into())], "=GAMMALN(A1)");
        assert!((n(&v) - 1.791759469228055).abs() < 1e-14);
    }

    #[test]
    fn blank_cell_num() {
        // Blank coerces to 0 -> #NUM!.
        assert_eq!(e(&eval("=GAMMALN(A1)")), CalcError::Num);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Num))], "=GAMMALN(A1)");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=GAMMALN()")), CalcError::Value);
        assert_eq!(e(&eval("=GAMMALN(1,2)")), CalcError::Value);
    }
}
