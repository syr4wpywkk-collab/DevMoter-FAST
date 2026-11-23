//! `XIRR(values, dates, [guess])` — internal rate of return for
//! irregularly dated cash flows (actual/365), solving
//! `Σ values[i] / (1+r)^((dates[i]-dates[0])/365) = 0`.
//! Spec: `docs/functions/XIRR.md`.
//!
//! Same positional pairing as [`xnpv`]. `dates[0]` is the discounting
//! origin; any earlier date is `#NUM!`. Solving reuses
//! [`finance::solve_rate`] (Newton then expanding bisection);
//! non-convergence or the absence of a sign change is `#NUM!`
//! (SPEC-OPEN: Excel's exact tolerance / 100-iteration cap).

use crate::common::finance;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::opt_num;
use super::xnpv::collect_flows;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let flows = match collect_flows(ctx, &args[0], &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(f) => f,
    };
    let guess = match opt_num(ctx, args, 2, 0.1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if flows.is_empty() {
        return Ok(Value::Error(CalcError::Num));
    }
    let d0 = flows[0].1;
    if flows.iter().any(|&(_, d)| d < d0) {
        return Ok(Value::Error(CalcError::Num));
    }
    let times: Vec<f64> = flows
        .iter()
        .map(|&(_, d)| (d - d0) as f64 / 365.0)
        .collect();
    let amounts: Vec<f64> = flows.iter().map(|&(v, _)| v).collect();
    match finance::solve_rate(&times, &amounts, guess) {
        Some(r) => Ok(Value::Number(r)),
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
    fn spec_excel_doc_example() {
        // ≈ 0.37336 (37.3%).
        let v = eval_with(
            &[
                ("A1", (-10000.0).into()),
                ("A2", 2750.0.into()),
                ("A3", 4250.0.into()),
                ("A4", 3250.0.into()),
                ("A5", 2750.0.into()),
                ("B1", 39448.0.into()),
                ("B2", 39508.0.into()),
                ("B3", 39751.0.into()),
                ("B4", 39859.0.into()),
                ("B5", 39904.0.into()),
            ],
            "=XIRR(A1:A5,B1:B5)",
        );
        assert!((n(&v) - 0.3733625).abs() < 1e-4, "got {}", n(&v));
    }

    #[test]
    fn one_year_exact() {
        // (1100/1000)^(365/365) - 1 = 0.1.
        let v = eval("=XIRR({-1000,1100},{45000,45365})");
        assert!((n(&v) - 0.1).abs() < 1e-9, "got {}", n(&v));
    }

    #[test]
    fn half_year_compounded() {
        // -1000 + 1210/(1+r)^2... 1050/(1+r)^(182/365) = 1000.
        let v = eval("=XIRR({-1000,1050},{45000,45182})");
        let want = 1.05f64.powf(365.0 / 182.0) - 1.0;
        assert!((n(&v) - want).abs() < 1e-6, "got {}", n(&v));
    }

    #[test]
    fn all_positive_num() {
        assert_eq!(e(&eval("=XIRR({100,200},{45000,45100})")), CalcError::Num);
    }

    #[test]
    fn all_negative_num() {
        assert_eq!(e(&eval("=XIRR({-100,-200},{45000,45100})")), CalcError::Num);
    }

    #[test]
    fn length_mismatch_num() {
        let v = eval_with(
            &[
                ("A1", (-100.0).into()),
                ("A2", 200.0.into()),
                ("B1", 45000.0.into()),
            ],
            "=XIRR(A1:A2,B1:B1)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn date_before_first_num() {
        let v = eval("=XIRR({-100,200},{45100,45000})");
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn explicit_guess() {
        let v = eval("=XIRR({-1000,1100},{45000,45365},0.5)");
        assert!((n(&v) - 0.1).abs() < 1e-9, "got {}", n(&v));
    }

    #[test]
    fn negative_rate_root() {
        // -1000 + 500/(1+r)^(1) = 0 -> r = -0.5.
        let v = eval("=XIRR({-1000,500},{45000,45365})");
        assert!((n(&v) + 0.5).abs() < 1e-9, "got {}", n(&v));
    }

    #[test]
    fn text_member_drops_pair() {
        let v = eval_with(
            &[
                ("A1", (-100.0).into()),
                ("A2", "x".into()),
                ("A3", 220.0.into()),
                ("B1", 45000.0.into()),
                ("B2", 45100.0.into()),
                ("B3", 45365.0.into()),
            ],
            "=XIRR(A1:A3,B1:B3)",
        );
        // -100 + 220/(1+r)^1 = 0 -> r = 1.2.
        assert!((n(&v) - 1.2).abs() < 1e-9, "got {}", n(&v));
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("B1", 45000.0.into())],
            "=XIRR(A1:A1,B1:B1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn non_numeric_guess_value_error() {
        assert_eq!(
            e(&eval(r#"=XIRR({-100,200},{45000,45100},"x")"#)),
            CalcError::Value
        );
    }
}
