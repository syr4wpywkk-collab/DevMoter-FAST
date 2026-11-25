//! `DISC(settlement, maturity, pr, redemption, [basis])` — discount
//! rate for a security held to maturity:
//! `(1 - pr/redemption) / YEARFRAC(settlement, maturity, basis)`.
//! Spec: `docs/functions/DISC.md`.
//!
//! The basis-1 denominator uses the shared
//! [`finance::year_fraction`] convention (SPEC-OPEN per the spec doc).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::finance;

use super::{basis_arg, number_arg, serial_arg};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 5) {
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
    let pr = take!(number_arg(ctx, args, 2));
    let redemption = take!(number_arg(ctx, args, 3));
    let basis = take!(basis_arg(ctx, args, 4));
    if settlement >= maturity || pr <= 0.0 || redemption <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    match finance::year_fraction(settlement, maturity, basis, system) {
        Some(yf) => Ok(Value::Number((1.0 - pr / redemption) / yf)),
        None => Ok(Value::Error(CalcError::Num)),
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

    #[test]
    fn spec_examples() {
        assert!(
            (n(&eval("=DISC(DATE(2007,1,25),DATE(2007,6,15),97.975,100,1)")) - 0.052420213).abs()
                < 1e-7
        );
        assert!(
            (n(&eval("=DISC(DATE(2007,1,25),DATE(2007,6,15),97.975,100,0)")) - 0.052071429).abs()
                < 1e-7
        );
        assert!(
            (n(&eval("=DISC(DATE(2007,1,25),DATE(2007,6,15),97.975,100,3)")) - 0.052420213).abs()
                < 1e-7
        );
        assert_eq!(
            e(&eval("=DISC(DATE(2007,6,15),DATE(2007,1,25),97.975,100,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn basis_default_zero() {
        assert_eq!(
            n(&eval("=DISC(DATE(2007,1,25),DATE(2007,6,15),97.975,100)")),
            n(&eval("=DISC(DATE(2007,1,25),DATE(2007,6,15),97.975,100,0)"))
        );
    }

    #[test]
    fn pr_above_redemption_negative_rate() {
        // A premium security yields a negative discount rate.
        let v = n(&eval("=DISC(DATE(2007,1,25),DATE(2007,6,15),102,100,3)"));
        assert!(v < 0.0);
    }

    #[test]
    fn nonpositive_price_num() {
        assert_eq!(
            e(&eval("=DISC(DATE(2007,1,25),DATE(2007,6,15),0,100,1)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=DISC(DATE(2007,1,25),DATE(2007,6,15),-5,100,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn nonpositive_redemption_num() {
        assert_eq!(
            e(&eval("=DISC(DATE(2007,1,25),DATE(2007,6,15),97,0,1)")),
            CalcError::Num
        );
    }

    #[test]
    fn bad_basis_num() {
        assert_eq!(
            e(&eval("=DISC(DATE(2007,1,25),DATE(2007,6,15),97.975,100,9)")),
            CalcError::Num
        );
    }

    #[test]
    fn dates_truncated() {
        let v = n(&eval(
            "=DISC(DATE(2007,1,25)+0.9,DATE(2007,6,15),97.975,100,1)",
        ));
        assert!((v - 0.052420213).abs() < 1e-7);
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(r#"=DISC("x",DATE(2007,6,15),97.975,100,1)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=DISC(1/0,DATE(2007,6,15),97.975,100,1)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=DISC(1,2,3)")), CalcError::Value);
        assert_eq!(e(&eval("=DISC(1,2,3,4,5,6)")), CalcError::Value);
    }
}
