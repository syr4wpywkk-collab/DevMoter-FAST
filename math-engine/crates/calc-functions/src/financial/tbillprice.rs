//! `TBILLPRICE(settlement, maturity, discount)` — price per $100 face
//! of a Treasury bill (actual/360):
//! `100 * (1 - discount * DSM / 360)`, `DSM = maturity - settlement`
//! in days. Spec: `docs/functions/TBILLPRICE.md`.
//!
//! The maturity must fall within one year of settlement; implemented
//! as `DSM > 365 -> #NUM!` (SPEC-OPEN: the leap-year boundary —
//! whether Excel counts a 366-day span as "more than one year" — is
//! unconfirmed). A discount large enough to drive the price
//! nonpositive is left to pass through (SPEC-OPEN: whether Excel
//! then reports `#NUM!`).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::{arg_date, arg_num};

/// Longest settlement→maturity span accepted by the TBILL* family
/// ("one year" per docs — see module comment).
pub(crate) const MAX_TBILL_SPAN: i64 = 365;

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
    let discount = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let dsm = maturity - settlement;
    if dsm <= 0 || dsm > MAX_TBILL_SPAN || discount <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(100.0 * (1.0 - discount * dsm as f64 / 360.0)))
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
    fn spec_192_days() {
        // 100*(1 - 0.09*192/360) = 95.2.
        let got = n(&eval("=TBILLPRICE(45704,45896,0.09)"));
        assert!((got - 95.2).abs() < 1e-9, "got {got}");
    }

    #[test]
    fn spec_excel_doc_example() {
        // 100*(1 - 0.0914*62/360).
        let got = n(&eval("=TBILLPRICE(39531,39593,0.0914)"));
        assert!((got - 98.4258889).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn spec_90_days() {
        assert_eq!(n(&eval("=TBILLPRICE(45000,45090,0.05)")), 98.75);
    }

    #[test]
    fn spec_180_days() {
        assert_eq!(n(&eval("=TBILLPRICE(45000,45180,0.05)")), 97.5);
    }

    #[test]
    fn dates_equal_num() {
        assert_eq!(e(&eval("=TBILLPRICE(45000,45000,0.05)")), CalcError::Num);
    }

    #[test]
    fn dates_inverted_num() {
        assert_eq!(e(&eval("=TBILLPRICE(45090,45000,0.05)")), CalcError::Num);
    }

    #[test]
    fn over_one_year_num() {
        assert_eq!(e(&eval("=TBILLPRICE(45000,45500,0.05)")), CalcError::Num);
    }

    #[test]
    fn exactly_365_days_allowed() {
        let got = n(&eval("=TBILLPRICE(45000,45365,0.05)"));
        assert!((got - 94.9305556).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn discount_zero_num() {
        assert_eq!(e(&eval("=TBILLPRICE(45000,45090,0)")), CalcError::Num);
    }

    #[test]
    fn discount_negative_num() {
        assert_eq!(e(&eval("=TBILLPRICE(45000,45090,-0.05)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(
            e(&eval(r#"=TBILLPRICE(45000,45090,"x")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn date_fraction_truncates() {
        assert_eq!(
            n(&eval("=TBILLPRICE(45000.5,45090.9,0.05)")),
            n(&eval("=TBILLPRICE(45000,45090,0.05)"))
        );
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=TBILLPRICE(45000,A1,0.05)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
