//! `TBILLYIELD(settlement, maturity, pr)` — yield of a Treasury bill
//! from its price per $100 face:
//! `(100 - pr) / pr * 360 / DSM`. Spec: `docs/functions/TBILLYIELD.md`.
//!
//! Same date bounds as [`crate::financial::tbillprice`]. `pr >= 100`
//! yields a nonpositive result that passes through — docs bound only
//! `pr <= 0` (SPEC-OPEN: unconfirmed for negative yields).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::tbillprice::MAX_TBILL_SPAN;
use super::{arg_date, arg_num};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let settlement = match arg_date(ctx, args, 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let maturity = match arg_date(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let pr = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let dsm = maturity - settlement;
    if dsm <= 0 || dsm > MAX_TBILL_SPAN || pr <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number((100.0 - pr) / pr * 360.0 / dsm as f64))
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
    fn spec_example() {
        // 1.25/98.75 * 360/90 = 0.0506329...
        let got = n(&eval("=TBILLYIELD(45000,45090,98.75)"));
        assert!((got - 0.0506329).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn inverse_of_tbillprice() {
        // Yield of the price TBILLPRICE computes is self-consistent:
        // (100-97.5)/97.5*360/180 = 0.0512821.
        let got = n(&eval("=TBILLYIELD(45000,45180,97.5)"));
        assert!((got - 0.0512821).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn price_100_zero_yield() {
        assert_eq!(n(&eval("=TBILLYIELD(45000,45090,100)")), 0.0);
    }

    #[test]
    fn price_over_100_negative() {
        // SPEC-OPEN: docs bound only pr <= 0; negative yield passes.
        let got = n(&eval("=TBILLYIELD(45000,45090,101)"));
        assert!(got < 0.0, "got {got}");
    }

    #[test]
    fn dates_equal_num() {
        assert_eq!(e(&eval("=TBILLYIELD(45000,45000,98)")), CalcError::Num);
    }

    #[test]
    fn dates_inverted_num() {
        assert_eq!(e(&eval("=TBILLYIELD(45090,45000,98)")), CalcError::Num);
    }

    #[test]
    fn over_one_year_num() {
        assert_eq!(e(&eval("=TBILLYIELD(45000,45500,98)")), CalcError::Num);
    }

    #[test]
    fn price_zero_num() {
        assert_eq!(e(&eval("=TBILLYIELD(45000,45090,0)")), CalcError::Num);
    }

    #[test]
    fn price_negative_num() {
        assert_eq!(e(&eval("=TBILLYIELD(45000,45090,-5)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(e(&eval(r#"=TBILLYIELD(45000,"x",98)"#)), CalcError::Value);
    }

    #[test]
    fn text_number_coerces() {
        let got = n(&eval(r#"=TBILLYIELD(45000,45090,"98.75")"#));
        assert!((got - 0.0506329).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::Ref))],
            "=TBILLYIELD(45000,45090,A1)",
        );
        assert_eq!(e(&v), CalcError::Ref);
    }
}
