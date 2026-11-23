//! `ROUND(number, num_digits)` — rounds half away from zero at the given
//! decimal digit. Spec: `docs/functions/ROUND.md`.
//!
//! Naive `f64::round` on `x * 10^d` is wrong for binary half-way cases
//! (`ROUND(1.005, 2)` must give `1.01` even though `1.005` is stored as
//! `1.00499999…`). This implementation rounds the *decimal* representation
//! of the input — 15 significant digits, matching Excel's precision —
//! half away from zero, then converts back.

use crate::ast::Expr;
use crate::error::CalcError;
use crate::eval::{EvalContext, EvalError};
use crate::functions::check_arity;
use crate::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let x = match ctx.eval(&args[0])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    let d = match ctx.eval(&args[1])?.to_number() {
        Ok(n) => n,
        Err(e) => return Ok(Value::Error(e)),
    };
    Ok(decimal_round(x, d))
}

/// Excel-style `ROUND`: half away from zero at `10^-digits`.
fn decimal_round(x: f64, digits: f64) -> Value {
    if !x.is_finite() || !digits.is_finite() {
        return Value::Error(CalcError::Num);
    }
    if x == 0.0 {
        return Value::Number(0.0);
    }
    // num_digits is truncated toward zero (SPEC-OPEN: confirm) and huge
    // magnitudes are clamped so the digit math below stays in range.
    let digits = digits.trunc().clamp(-320.0, 320.0) as i32;

    // Decimal view: x = 0.d[0]d[1]…d[14] × 10^exp10, 15 significant digits.
    let s = format!("{:.14e}", x.abs());
    // s looks like "d.dddddddddddddde±XX" (15 sig digits).
    let (mantissa, exp) = s.split_once('e').unwrap();
    let exp10: i32 = exp.parse::<i32>().unwrap() + 1;
    let mut d: Vec<u8> = mantissa.bytes().filter(|b| b.is_ascii_digit()).collect();
    debug_assert_eq!(d.len(), 15);

    // Digits d[k] sit at decimal place exp10-1-k. Rounding at place
    // -digits keeps `keep = exp10 + digits` significant digits.
    let keep = exp10 + digits;
    if keep < 0 || (keep == 0 && d[0] < b'5') {
        return Value::Number(0.0);
    }
    let (mant, out_exp): (u64, i32) = if keep == 0 {
        // Below the first significant digit but rounds up: 10^-digits.
        (1, -digits)
    } else if keep as usize >= d.len() {
        return Value::Number(x);
    } else {
        let keep = keep as usize;
        let mut out_exp = exp10;
        let mut len = keep;
        if d[keep] >= b'5' {
            // Half away from zero: increment the kept digits with carry.
            let mut i = keep;
            loop {
                if i == 0 {
                    // 9.99… rounds up to 10 → one more digit, exponent +1.
                    d.insert(0, b'1');
                    len += 1;
                    out_exp += 1;
                    break;
                }
                i -= 1;
                if d[i] == b'9' {
                    d[i] = b'0';
                } else {
                    d[i] += 1;
                    break;
                }
            }
        }
        let mant = d[..len]
            .iter()
            .fold(0u64, |m, b| m * 10 + (b - b'0') as u64);
        (mant, out_exp - len as i32)
    };
    // Rebuild via a decimal string so the result is the correctly-rounded
    // f64 (e.g. "15e-1" -> 1.5, not 1.5000000000000002).
    let result: f64 = format!("{mant}e{out_exp}").parse().unwrap_or(0.0);
    Value::Number(result.copysign(x))
}

#[cfg(test)]
mod tests {
    use super::super::helpers::test_support::*;
    use crate::{CalcError, Value};

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
    fn half_up_positive() {
        assert_eq!(n(&eval("=ROUND(2.5,0)")), 3.0);
    }

    #[test]
    fn half_away_negative() {
        assert_eq!(n(&eval("=ROUND(-2.5,0)")), -3.0);
        assert_eq!(n(&eval("=ROUND(-0.5,0)")), -1.0);
    }

    #[test]
    fn decimal_places() {
        assert!((n(&eval("=ROUND(2.345,2)")) - 2.35).abs() < 1e-12);
        assert_eq!(n(&eval("=ROUND(2.349,2)")), 2.35);
        assert!((n(&eval("=ROUND(1.234567,4)")) - 1.2346).abs() < 1e-12);
    }

    #[test]
    fn binary_halfway_case() {
        // 1.005 is stored below the decimal half; decimal-aware rounding
        // still gives 1.01 (specOpen fixture, expected Excel behavior).
        assert!((n(&eval("=ROUND(1.005,2)")) - 1.01).abs() < 1e-12);
        assert_eq!(n(&eval("=ROUND(0.5,0)")), 1.0);
    }

    #[test]
    fn negative_digits() {
        assert_eq!(n(&eval("=ROUND(1234.567,-2)")), 1200.0);
        assert_eq!(n(&eval("=ROUND(15,-1)")), 20.0);
        assert_eq!(n(&eval("=ROUND(14,-1)")), 10.0);
    }

    #[test]
    fn carry_past_nines() {
        assert_eq!(n(&eval("=ROUND(9.99,1)")), 10.0);
        assert_eq!(n(&eval("=ROUND(999,2)")), 999.0);
        assert_eq!(n(&eval("=ROUND(0.999,0)")), 1.0);
    }

    #[test]
    fn rounds_to_zero() {
        assert_eq!(n(&eval("=ROUND(0.4,0)")), 0.0);
        assert_eq!(n(&eval("=ROUND(0.04,1)")), 0.0);
        assert_eq!(n(&eval("=ROUND(1,-2)")), 0.0);
    }

    #[test]
    fn no_change_when_more_digits() {
        assert_eq!(n(&eval("=ROUND(1.5,5)")), 1.5);
        assert_eq!(n(&eval("=ROUND(123,0)")), 123.0);
    }

    #[test]
    fn text_number_coerces() {
        assert_eq!(n(&eval(r#"=ROUND("2.5",0)"#)), 3.0);
    }

    #[test]
    fn bad_text_value_error() {
        assert_eq!(e(&eval(r#"=ROUND("x",0)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=ROUND(1/0,0)")), CalcError::DivZero);
    }

    #[test]
    fn negative_value_negative_digits() {
        assert_eq!(n(&eval("=ROUND(-15,-1)")), -20.0);
        assert_eq!(n(&eval("=ROUND(-1234.567,-2)")), -1200.0);
    }
}
