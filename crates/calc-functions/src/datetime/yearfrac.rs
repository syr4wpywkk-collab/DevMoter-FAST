//! `YEARFRAC(start_date, end_date, [basis])` — fraction of a year
//! between two dates under a day-count convention.
//! Spec: `docs/functions/YEARFRAC.md`.
//!
//! `basis` (default `0`, truncated): `0` US 30/360, `1` actual/actual,
//! `2` actual/360, `3` actual/365, `4` European 30/360 — the shared
//! [`crate::common::finance::year_fraction`] kernel (same code the
//! bond functions use). A basis outside `0..=4` is `#NUM!`.
//!
//! `start > end`: per Microsoft's documentation the two dates are
//! exchanged, so the result is the same positive value as
//! `YEARFRAC(end, start, basis)`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::{coercion, date_serial, date_text, finance};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let system = ctx.date_system();
    let start = match date_text::eval_date(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let end = match date_text::eval_date(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let basis = match coercion::eval_opt_number(ctx, args.get(2), 0.0)? {
        Ok(v) => match finance::DayCountBasis::from_code(date_serial::trunc_to_i64(v)) {
            Some(b) => b,
            None => return Ok(Value::Error(CalcError::Num)),
        },
        Err(e) => return Ok(Value::Error(e)),
    };
    match finance::year_fraction(start.min(end), start.max(end), basis, system) {
        Some(f) => Ok(Value::Number(f)),
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

    fn assert_frac(formula: &str, want: f64) {
        let got = n(&eval(formula));
        assert!((got - want).abs() < 1e-9, "{formula}: {got} != {want}");
    }

    #[test]
    fn basis_0_and_4() {
        // Full 30/360 year: 2023-01-01 = 44927 -> 2024-01-01 = 45292.
        assert_frac("=YEARFRAC(44927,45292,0)", 1.0);
        assert_frac("=YEARFRAC(44927,45292)", 1.0); // default basis 0
        assert_frac("=YEARFRAC(44927,45292,4)", 1.0);
    }

    #[test]
    fn basis_2_and_3() {
        // 44927 -> 45292 is 365 actual days.
        assert_frac("=YEARFRAC(44927,45292,2)", 365.0 / 360.0);
        assert_frac("=YEARFRAC(44927,45292,3)", 1.0);
    }

    #[test]
    fn basis_1_same_year() {
        // 2023 (non-leap): 180 actual days / 365.
        assert_frac("=YEARFRAC(44927,45107,1)", 180.0 / 365.0);
        // 2024 (leap): 182 days / 366.
        assert_frac("=YEARFRAC(45292,45474,1)", 182.0 / 366.0);
    }

    #[test]
    fn swapped_args_are_positive() {
        // Documented behavior: start > end exchanges the dates.
        let fwd = n(&eval("=YEARFRAC(44900,45000,0)"));
        let rev = n(&eval("=YEARFRAC(45000,44900,0)"));
        assert!(fwd > 0.0 && (fwd - rev).abs() < 1e-12);
        assert!((fwd - 100.0 / 360.0).abs() < 1e-9);
    }

    #[test]
    fn same_date_is_zero() {
        assert_eq!(n(&eval("=YEARFRAC(45000,45000)")), 0.0);
        assert_eq!(n(&eval("=YEARFRAC(45000,45000,3)")), 0.0);
    }

    #[test]
    fn thirty_360_conventions() {
        // 2021-01-01 -> 2024-01-01: 1080 30/360 days -> 3.0.
        assert_frac("=YEARFRAC(44197,45292,0)", 3.0);
        assert_frac("=YEARFRAC(44197,45292,4)", 3.0);
    }

    #[test]
    fn basis_truncates() {
        // 1.9 truncates to basis 1.
        let a = n(&eval("=YEARFRAC(44927,45107,1.9)"));
        let b = n(&eval("=YEARFRAC(44927,45107,1)"));
        assert!((a - b).abs() < 1e-12);
    }

    #[test]
    fn invalid_basis_is_num() {
        for b in [-1, 5, 99] {
            assert_eq!(
                e(&eval(&format!("=YEARFRAC(44927,45292,{b})"))),
                CalcError::Num,
                "basis {b}"
            );
        }
    }

    #[test]
    fn text_dates_parse() {
        assert_frac("=YEARFRAC(\"2023-01-01\",\"2024-01-01\",0)", 1.0);
    }

    #[test]
    fn unparseable_is_value() {
        assert_eq!(e(&eval("=YEARFRAC(\"x\",45000)")), CalcError::Value);
        assert_eq!(e(&eval("=YEARFRAC(TRUE,45000)")), CalcError::Value);
    }

    #[test]
    fn out_of_domain_is_num() {
        assert_eq!(e(&eval("=YEARFRAC(-1,45000)")), CalcError::Num);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=YEARFRAC(1/0,45000)")), CalcError::DivZero);
    }

    #[test]
    fn arity_checked() {
        assert_eq!(e(&eval("=YEARFRAC(1)")), CalcError::Value);
        assert_eq!(e(&eval("=YEARFRAC(1,2,0,4)")), CalcError::Value);
    }
}
