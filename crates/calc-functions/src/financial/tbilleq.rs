//! `TBILLEQ(settlement, maturity, discount)` — bond-equivalent yield
//! of a Treasury bill. Spec: `docs/functions/TBILLEQ.md`.
//!
//! `DSM <= 182` days: `365*discount / (360 - discount*DSM)`.
//! `DSM > 182`: the Treasury coupon-equivalent closed form
//! `(-2x + 2*sqrt(x^2 + (2x-1)*y)) / (2x - 1)` with `x = DSM/365` and
//! `y = discount*DSM / (360 - discount*DSM)` (i.e. `(100-P)/P` from
//! the T-bill price) — the published Excel/Treasury quadratic
//! (SPEC-OPEN: coefficient confirmation pending empirical capture).
//!
//! Denominator `360 - discount*DSM <= 0` is `#NUM!` (SPEC-OPEN:
//! `#NUM!` vs `#DIV/0!` unconfirmed).

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
    let discount = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let dsm = maturity - settlement;
    if dsm <= 0 || dsm > MAX_TBILL_SPAN || discount <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let denom = 360.0 - discount * dsm as f64;
    if denom <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    let bey = if dsm <= 182 {
        365.0 * discount / denom
    } else {
        let x = dsm as f64 / 365.0;
        let y = discount * dsm as f64 / denom;
        let disc = x * x + (2.0 * x - 1.0) * y;
        (-2.0 * x + 2.0 * disc.sqrt()) / (2.0 * x - 1.0)
    };
    Ok(Value::Number(bey))
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
    fn spec_excel_doc_example() {
        // 365*0.0914 / (360 - 0.0914*62) = 0.094151.
        let got = n(&eval("=TBILLEQ(39531,39593,0.0914)"));
        assert!((got - 0.0941514).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn spec_90_days() {
        // 365*0.05 / 355.5 = 0.05133539.
        let got = n(&eval("=TBILLEQ(45000,45090,0.05)"));
        assert!((got - 0.0513354).abs() < 1e-6, "got {got}");
    }

    #[test]
    fn boundary_182_days_simple() {
        // DSM = 182 uses the simple formula.
        let got = n(&eval("=TBILLEQ(45000,45182,0.05)"));
        let want = 365.0 * 0.05 / (360.0 - 0.05 * 182.0);
        assert!((got - want).abs() < 1e-12, "got {got}");
    }

    #[test]
    fn over_182_quadratic() {
        // DSM = 360: x = 360/365, y = 0.05*360/(360-18) = 18/342.
        let got = n(&eval("=TBILLEQ(45000,45360,0.05)"));
        let x = 360.0f64 / 365.0;
        let y = 0.05 * 360.0 / (360.0 - 18.0);
        let want = (-2.0 * x + 2.0 * (x * x + (2.0 * x - 1.0) * y).sqrt()) / (2.0 * x - 1.0);
        assert!((got - want).abs() < 1e-12, "got {got}");
    }

    #[test]
    fn dates_equal_num() {
        assert_eq!(e(&eval("=TBILLEQ(45000,45000,0.05)")), CalcError::Num);
    }

    #[test]
    fn dates_inverted_num() {
        assert_eq!(e(&eval("=TBILLEQ(45090,45000,0.05)")), CalcError::Num);
    }

    #[test]
    fn over_one_year_num() {
        assert_eq!(e(&eval("=TBILLEQ(45000,45500,0.05)")), CalcError::Num);
    }

    #[test]
    fn discount_zero_num() {
        assert_eq!(e(&eval("=TBILLEQ(45000,45090,0)")), CalcError::Num);
    }

    #[test]
    fn discount_negative_num() {
        assert_eq!(e(&eval("=TBILLEQ(45000,45090,-0.05)")), CalcError::Num);
    }

    #[test]
    fn denominator_zero_num() {
        // discount*DSM = 360 -> denominator 0 (e.g. d=2, DSM=180).
        assert_eq!(e(&eval("=TBILLEQ(45000,45180,2.0)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(e(&eval(r#"=TBILLEQ(45000,45090,"x")"#)), CalcError::Value);
    }

    #[test]
    fn date_fraction_truncates() {
        assert_eq!(
            n(&eval("=TBILLEQ(45000.5,45090.9,0.05)")),
            n(&eval("=TBILLEQ(45000,45090,0.05)"))
        );
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=TBILLEQ(45000,A1,0.05)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }
}
