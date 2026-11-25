//! `MIRR(values, finance_rate, reinvest_rate)` — modified internal
//! rate of return. Spec: `docs/functions/MIRR.md`.
//!
//! `MIRR = (-FV(positive, reinvest) / PV(negative, finance))^(1/(n-1))
//! - 1`. Same range coercion as `IRR`; no sign change -> `#DIV/0!`
//! (documented Excel behavior, unlike `IRR`'s `#NUM!`).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let values = match super::irr::collect_flows(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let fin = match coercion::eval_number(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let rein = match coercion::eval_number(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let n = values.len();
    let has_pos = values.iter().any(|&v| v > 0.0);
    let has_neg = values.iter().any(|&v| v < 0.0);
    if n < 2 || !has_pos || !has_neg {
        // No sign change / empty -> #DIV/0! (documented; MIRR.md).
        return Ok(Value::Error(CalcError::DivZero));
    }
    let mut pv_neg = 0.0;
    let mut fv_pos = 0.0;
    for (i, &v) in values.iter().enumerate() {
        if v < 0.0 {
            pv_neg += v / (1.0 + fin).powi(i as i32);
        } else {
            fv_pos += v * (1.0 + rein).powi((n - 1 - i) as i32);
        }
    }
    let v = (-fv_pos / pv_neg).powf(1.0 / (n - 1) as f64) - 1.0;
    if !v.is_finite() {
        return Ok(Value::Error(CalcError::Num));
    }
    Ok(Value::Number(v))
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
    fn doc_example_a() {
        let v = eval("=MIRR({-120000,39000,30000,21000,37000,46000},0.1,0.12)");
        assert!((n(&v) - 0.12609413).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn doc_example_b() {
        let v = eval("=MIRR({-120000,39000,30000,21000,37000,46000},0.1,0.14)");
        assert!((n(&v) - 0.13475911).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn doc_example_c() {
        let v = eval("=MIRR({-120000,39000,30000,21000,37000,46000},0.12,0.1)");
        assert!((n(&v) - 0.11750926).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn all_positive_div0() {
        assert_eq!(
            e(&eval("=MIRR({120000,39000},0.1,0.12)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn all_negative_div0() {
        assert_eq!(
            e(&eval("=MIRR({-120000,-39000},0.1,0.12)")),
            CalcError::DivZero
        );
    }

    #[test]
    fn equal_rates_closed_form() {
        // MIRR uses fixed exponents, not period solving: (126/100)^0.5-1.
        let v = eval("=MIRR({-100,60,60},0.1,0.1)");
        assert!((n(&v) - 1.26f64.sqrt() + 1.0).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn range_ignores_text_blank() {
        let v = eval_with(
            &[
                ("A1", (-100.0).into()),
                ("A2", "x".into()),
                ("A4", 121.0.into()),
            ],
            "=MIRR(A1:A5,0.1,0.12)",
        );
        assert!(n(&v).is_finite());
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[
                ("A1", (-100.0).into()),
                ("A2", Value::Error(CalcError::NA)),
                ("A3", 121.0.into()),
            ],
            "=MIRR(A1:A3,0.1,0.12)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn bad_finance_text_value() {
        assert_eq!(e(&eval(r#"=MIRR({-100,121},"x",0.12)"#)), CalcError::Value);
    }

    #[test]
    fn two_flows() {
        // -100 at t0, 121 at t1: (-121/1)/( -100 ) ^1 -1 = 0.21.
        let v = eval("=MIRR({-100,121},0.5,0.5)");
        assert!((n(&v) - 0.21).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=MIRR({-100,121},0.1)")), CalcError::Value);
    }
}
