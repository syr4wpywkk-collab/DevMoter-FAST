//! `ACCRINTM(issue, maturity, rate, [par], [basis])` — accrued interest
//! for a security that pays interest at maturity:
//! `par * rate * days(issue, maturity) / days_in_first_year`.
//! Spec: `docs/functions/ACCRINTM.md`.
//!
//! The denominator uses [`finance::year_diff`] (360 for bases 0/2/4,
//! 365 for basis 3, length of the issue's calendar year for basis 1 —
//! the year anchor is SPEC-OPEN per the spec doc).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use crate::common::finance;

use super::{basis_arg, number_arg, opt_number_arg, serial_arg};

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 5) {
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
    let issue = take!(serial_arg(ctx, args, 0, system));
    let maturity = take!(serial_arg(ctx, args, 1, system));
    let rate = take!(number_arg(ctx, args, 2));
    let par = take!(opt_number_arg(ctx, args, 3, 1000.0));
    let basis = take!(basis_arg(ctx, args, 4));
    if issue >= maturity || rate <= 0.0 || par <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    match finance::year_diff(issue, maturity, basis, system) {
        Some(yd) => Ok(Value::Number(par * rate * yd)),
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
            (n(&eval(
                "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,3)"
            )) - 20.54794521)
                .abs()
                < 1e-6
        );
        assert!(
            (n(&eval(
                "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,0)"
            )) - 20.55555556)
                .abs()
                < 1e-6
        );
        assert!(
            (n(&eval(
                "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,5000,3)"
            )) - 102.7397260)
                .abs()
                < 1e-5
        );
        assert_eq!(
            e(&eval(
                "=ACCRINTM(DATE(2008,6,15),DATE(2008,4,1),0.1,1000,3)"
            )),
            CalcError::Num
        );
    }

    #[test]
    fn par_default_1000() {
        assert_eq!(
            n(&eval("=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,,3)")),
            n(&eval(
                "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,3)"
            ))
        );
        assert_eq!(
            n(&eval("=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1)")),
            n(&eval(
                "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,0)"
            ))
        );
    }

    #[test]
    fn basis_variants() {
        // 75 actual days: /360 (basis 2), /365 (basis 3), issue-year
        // 366 for leap-2008 (basis 1).
        let b2 = n(&eval(
            "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,2)",
        ));
        assert!((b2 - 1000.0 * 0.1 * 75.0 / 360.0).abs() < 1e-9);
        let b1 = n(&eval(
            "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,1)",
        ));
        assert!((b1 - 1000.0 * 0.1 * 75.0 / 366.0).abs() < 1e-9);
        let b4 = n(&eval(
            "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,4)",
        ));
        assert!((b4 - 1000.0 * 0.1 * 74.0 / 360.0).abs() < 1e-9);
    }

    #[test]
    fn same_dates_num() {
        assert_eq!(
            e(&eval("=ACCRINTM(DATE(2008,4,1),DATE(2008,4,1),0.1,1000,3)")),
            CalcError::Num
        );
    }

    #[test]
    fn nonpositive_rate_par_num() {
        assert_eq!(
            e(&eval("=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0,1000,3)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),-0.1,1000,3)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,0,3)")),
            CalcError::Num
        );
        assert_eq!(
            e(&eval("=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,-5,3)")),
            CalcError::Num
        );
    }

    #[test]
    fn bad_basis_num() {
        assert_eq!(
            e(&eval(
                "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,5)"
            )),
            CalcError::Num
        );
        assert_eq!(
            e(&eval(
                "=ACCRINTM(DATE(2008,4,1),DATE(2008,6,15),0.1,1000,-1)"
            )),
            CalcError::Num
        );
    }

    #[test]
    fn negative_date_num() {
        assert_eq!(
            e(&eval("=ACCRINTM(-1,DATE(2008,6,15),0.1,1000,3)")),
            CalcError::Num
        );
    }

    #[test]
    fn dates_truncated() {
        let frac = n(&eval(
            "=ACCRINTM(DATE(2008,4,1)+0.9,DATE(2008,6,15),0.1,1000,3)",
        ));
        assert!((frac - 20.54794521).abs() < 1e-6);
    }

    #[test]
    fn bad_text_value() {
        assert_eq!(
            e(&eval(r#"=ACCRINTM("x",DATE(2008,6,15),0.1,1000,3)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval("=ACCRINTM(1/0,DATE(2008,6,15),0.1,1000,3)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ACCRINTM(1,2)")), CalcError::Value);
        assert_eq!(e(&eval("=ACCRINTM(1,2,3,4,5,6)")), CalcError::Value);
    }
}
