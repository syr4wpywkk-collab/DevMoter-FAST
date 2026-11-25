//! `DURATION(settlement, maturity, coupon, yld, frequency, [basis])` —
//! Macaulay duration in years of a $100-par security paying periodic
//! interest. Spec: `docs/functions/DURATION.md`.
//!
//! Reference form (LibreOffice `GetDuration`, matching Excel): with
//! `nDiff = YEARFRAC(settlement, maturity, basis) * frequency - N`
//! (the fractional offset of the settlement inside its coupon period;
//! `N = COUPNUM`), the cash flow `i` lands `i + nDiff` periods out:
//!
//! ```text
//! DURATION = [ Σ_{i<N} (i+nDiff)·cf·y^{-(i+nDiff)} + (N+nDiff)·(cf+100)·y^{-(N+nDiff)} ]
//!            / [ Σ_{i<N} cf·y^{-(i+nDiff)} + (cf+100)·y^{-(N+nDiff)} ] / frequency
//! ```
//! with `cf = 100·coupon/frequency` and `y = 1 + yld/frequency`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::finance;

use super::{basis_arg, freq_arg, number_arg, serial_arg};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 5, 6) {
        return Ok(Value::Error(e));
    }
    let system = ctx.date_system();
    macro_rules! take {
        ($e:expr) => {
            match $e? {
                Ok(v) => v,
                Err(e) => return Ok(Value::Error(e)),
            }
        };
    }
    let settlement = take!(serial_arg(ctx, args, 0, system));
    let maturity = take!(serial_arg(ctx, args, 1, system));
    let coupon = take!(number_arg(ctx, args, 2));
    let yld = take!(number_arg(ctx, args, 3));
    let frequency = take!(freq_arg(ctx, args, 4));
    let basis = take!(basis_arg(ctx, args, 5));
    if settlement >= maturity || coupon < 0.0 || yld < 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let sched = match finance::coupon_schedule(settlement, maturity, frequency, system) {
        Some(s) => s,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    let yf = match finance::year_fraction(settlement, maturity, basis, system) {
        Some(yf) => yf,
        None => return Ok(Value::Error(CalcError::Num)),
    };
    let n = sched.remaining;
    let ndiff = yf * frequency as f64 - n as f64;
    let cf = 100.0 * coupon / frequency as f64;
    let y = 1.0 + yld / frequency as f64;
    let mut dur = 0.0;
    let mut price = 0.0;
    for t in 1..n {
        let ti = t as f64 + ndiff;
        let pv = cf / y.powf(ti);
        dur += ti * pv;
        price += pv;
    }
    let tn = n as f64 + ndiff;
    let last = (cf + 100.0) / y.powf(tn);
    dur += tn * last;
    price += last;
    Ok(Value::Number(dur / price / frequency as f64))
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
        assert!(
            (n(&eval(
                "=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,0)"
            )) - 5.9937750)
                .abs()
                < 1e-6
        );
        assert!(
            (n(&eval(
                "=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,1,0)"
            )) - 6.1490679)
                .abs()
                < 1e-6
        );
        assert!(
            (n(&eval(
                "=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.08,2,0)"
            )) - 6.0591937)
                .abs()
                < 1e-6
        );
        assert_eq!(
            e(&eval(
                "=DURATION(DATE(2016,1,1),DATE(2008,1,1),0.08,0.09,2)"
            )),
            CalcError::Num
        );
    }

    #[test]
    fn zero_coupon_is_maturity_time() {
        // Zero coupon: duration = time to maturity in years (here the
        // bond matures in exactly 16 half-periods = 8 years).
        let v = n(&eval("=DURATION(DATE(2008,1,1),DATE(2016,1,1),0,0.09,2,0)"));
        assert!((v - 8.0).abs() < 1e-9);
    }

    #[test]
    fn basis_default_zero() {
        assert_eq!(
            n(&eval(
                "=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2)"
            )),
            n(&eval(
                "=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,0)"
            ))
        );
    }

    #[test]
    fn mid_period_settlement() {
        // A valid mid-period settlement still yields a sane duration
        // below the remaining time to maturity.
        let v = n(&eval(
            "=DURATION(DATE(2008,3,15),DATE(2016,1,1),0.08,0.09,2,0)",
        ));
        assert!(v > 0.0 && v < 8.0);
    }

    #[test]
    fn negative_rates_num() {
        assert_eq!(
            e(&eval(
                "=DURATION(DATE(2008,1,1),DATE(2016,1,1),-0.01,0.09,2,0)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,-0.01,2,0)"
            )),
            CalcError::Num
        );
    }

    #[test]
    fn bad_frequency_basis_num() {
        assert_eq!(
            e(&eval(
                "=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,3,0)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,5)"
            )),
            CalcError::Num
        );
    }

    #[test]
    fn basis1_varies() {
        let v = n(&eval(
            "=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0.09,2,1)",
        ));
        assert!(v > 5.0 && v < 7.0);
    }

    #[test]
    fn zero_yield() {
        let v = n(&eval("=DURATION(DATE(2008,1,1),DATE(2016,1,1),0.08,0,2,0)"));
        assert!(v > 5.0 && v < 8.0);
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(r#"=DURATION("x",DATE(2016,1,1),0.08,0.09,2,0)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=DURATION(1/0,DATE(2016,1,1),0.08,0.09,2,0)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DURATION(1,2,3,4)")), CalcError::Value);
        assert_eq!(e(&eval("=DURATION(1,2,3,4,5,6,7)")), CalcError::Value);
    }
}
