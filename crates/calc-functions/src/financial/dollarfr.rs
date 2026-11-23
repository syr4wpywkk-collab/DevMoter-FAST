//! `DOLLARFR(decimal_dollar, fraction)` — converts a decimal price to
//! `integer.numerator` notation where the numerator occupies the digit
//! count of `fraction` (`1.125` at fraction 16 -> `1.02`, read "1 and
//! 2/16"). Spec: `docs/functions/DOLLARFR.md`.
//!
//! Follows the reference formula `int + frac * fraction *
//! 10^(-ceil(log10(fraction)))`: denominators below 10 carry ONE digit,
//! so `DOLLARFR(1.5, 8)` is `1.4` (1 and 4/8) — the spec doc's example
//! table shows `1.04`, marked there as confirm-needed and tracked as
//! SPEC-OPEN.

use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::{dollarde::fraction_denominator, number_arg};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let dollar = match number_arg(ctx, args, 0)? {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let frac = match number_arg(ctx, args, 1)? {
        Ok(v) => v,
        Err(e) => return Ok(Value::Error(e)),
    };
    let den = match fraction_denominator(frac) {
        Ok(d) => d as f64,
        Err(e) => return Ok(Value::Error(e)),
    };
    let int = dollar.trunc();
    let scale = 10f64.powf(-den.log10().ceil());
    Ok(Value::Number(int + (dollar - int) * den * scale))
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
        assert!((n(&eval("=DOLLARFR(1.125,16)")) - 1.02).abs() < 1e-9);
        assert!((n(&eval("=DOLLARFR(1.125,32)")) - 1.04).abs() < 1e-9);
        assert!((n(&eval("=DOLLARFR(-1.125,16)")) + 1.02).abs() < 1e-9);
        assert_eq!(e(&eval("=DOLLARFR(1.125,0)")), CalcError::DivZero);
    }

    #[test]
    fn single_digit_denominator() {
        // Fraction 8 -> one numerator digit: 1.5 = 1 and 4/8 -> 1.4.
        assert!((n(&eval("=DOLLARFR(1.5,8)")) - 1.4).abs() < 1e-9);
    }

    #[test]
    fn negative_fraction_num() {
        assert_eq!(e(&eval("=DOLLARFR(1.125,-16)")), CalcError::Num);
    }

    #[test]
    fn noninteger_fraction_truncates() {
        assert!((n(&eval("=DOLLARFR(1.125,16.9)")) - 1.02).abs() < 1e-9);
    }

    #[test]
    fn zero() {
        assert_eq!(n(&eval("=DOLLARFR(0,16)")), 0.0);
    }

    #[test]
    fn numerator_carry() {
        // 0.99*16 = 15.84 -> two digits "15.84": reference formula does
        // not round the numerator, yielding 1.1584's truncation 1.15
        // territory; assert the formula value (specOpen in fixture).
        let v = n(&eval("=DOLLARFR(1.99,16)"));
        assert!((v - (1.0 + 0.99 * 16.0 * 0.01)).abs() < 1e-9);
    }

    #[test]
    fn zero_fraction_div_zero() {
        assert_eq!(e(&eval("=DOLLARFR(1.125,0)")), CalcError::DivZero);
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(e(&eval(r#"=DOLLARFR("x",16)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DOLLARFR(1/0,16)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DOLLARFR(1)")), CalcError::Value);
        assert_eq!(e(&eval("=DOLLARFR(1,2,3)")), CalcError::Value);
    }
}
