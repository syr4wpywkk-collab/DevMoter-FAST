//! `DOLLARDE(fractional_dollar, fraction)` — converts a price quoted
//! as `integer.numerator` (numerator counted in the digits needed for
//! `fraction`) to decimal. Spec: `docs/functions/DOLLARDE.md`.
//!
//! Numerator scale follows the reference formula
//! `frac * 10^ceil(log10(fraction)) / fraction` (LibreOffice/Excel
//! ATP), which gives `1.02 -> 2/16` and `1.1 -> 10/16`. The treatment
//! of fractional parts with more digits than the denominator needs
//! (`1.025` at fraction 16) is SPEC-OPEN.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::date_serial;

use super::number_arg;

/// `(truncated denominator, error)` shared with `DOLLARFR`: `< 0` ->
/// `#NUM!`, truncates to `0` -> `#DIV/0!`.
pub(crate) fn fraction_denominator(v: f64) -> Result<i64, CalcError> {
    match date_serial::trunc_to_i64(v) {
        f if f < 0 => Err(CalcError::Num),
        0 => Err(CalcError::DivZero),
        f => Ok(f),
    }
}

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
    let scale = 10f64.powf(den.log10().ceil());
    Ok(Value::Number(int + (dollar - int) / den * scale))
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
        assert!((n(&eval("=DOLLARDE(1.02,16)")) - 1.125).abs() < 1e-12);
        assert!((n(&eval("=DOLLARDE(1.1,16)")) - 1.625).abs() < 1e-12);
        assert!((n(&eval("=DOLLARDE(-1.02,16)")) + 1.125).abs() < 1e-12);
        assert_eq!(e(&eval("=DOLLARDE(1.02,0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=DOLLARDE(1.02,-16)")), CalcError::Num);
    }

    #[test]
    fn single_digit_denominator() {
        // Fraction 8 -> one numerator digit: 1.4 = 1 and 4/8 = 1.5.
        assert_eq!(n(&eval("=DOLLARDE(1.4,8)")), 1.5);
    }

    #[test]
    fn three_digit_denominator() {
        // Fraction 128 -> three digits: 1.016 = 1 and 16/128 = 1.125.
        assert!((n(&eval("=DOLLARDE(1.016,128)")) - 1.125).abs() < 1e-9);
    }

    #[test]
    fn noninteger_fraction_truncates() {
        assert!((n(&eval("=DOLLARDE(1.02,16.9)")) - 1.125).abs() < 1e-12);
    }

    #[test]
    fn zero_dollar() {
        assert_eq!(n(&eval("=DOLLARDE(0,16)")), 0.0);
    }

    #[test]
    fn inverse_of_dollarfr() {
        let de = n(&eval("=DOLLARDE(DOLLARFR(1.9375,32),32)"));
        assert!((de - 1.9375).abs() < 1e-9);
    }

    #[test]
    fn negative_dollar_keeps_sign() {
        assert_eq!(n(&eval("=DOLLARDE(-1.02,16)")), -1.125);
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(e(&eval(r#"=DOLLARDE("x",16)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=DOLLARDE(1/0,16)")), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DOLLARDE(1)")), CalcError::Value);
        assert_eq!(e(&eval("=DOLLARDE(1,2,3)")), CalcError::Value);
    }
}
