//! `XNPV(rate, values, dates)` — present value of irregularly dated
//! cash flows discounted from `dates[0]` (actual/365):
//! `Σ values[i] / (1+rate)^((dates[i]-dates[0])/365)`.
//! Spec: `docs/functions/XNPV.md`.
//!
//! Values/dates pair positionally on raw member count — a length
//! mismatch is `#NUM!`. Range members that are not numbers drop
//! their pair (SPEC-OPEN: skip-vs-error mirrors the IRR-family open
//! question). Any date earlier than `dates[0]` and `rate <= -1` are
//! `#NUM!` (SPEC-OPEN: `rate <= -1` error class).

use crate::common::date_serial;
use crate::common::finance;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::{arg_members, arg_num, member_number};

/// `(value, date_serial)` pairs after positional filtering.
pub(crate) fn collect_flows(
    ctx: &mut EvalContext<'_>,
    values_arg: &Expr,
    dates_arg: &Expr,
) -> Result<Result<Vec<(f64, i64)>, CalcError>, EvalError> {
    let vs = arg_members(ctx, values_arg)?;
    let ds = arg_members(ctx, dates_arg)?;
    if vs.len() != ds.len() {
        return Ok(Err(CalcError::Num));
    }
    let mut out = Vec::with_capacity(vs.len());
    for ((vv, vr), (dv, dr)) in vs.iter().zip(ds.iter()) {
        let v = match member_number(vv, *vr) {
            Ok(v) => v,
            Err(e) => return Ok(Err(e)),
        };
        let d = match member_number(dv, *dr) {
            Ok(d) => d,
            Err(e) => return Ok(Err(e)),
        };
        if let (Some(v), Some(d)) = (v, d) {
            out.push((v, date_serial::trunc_to_i64(d)));
        }
    }
    Ok(Ok(out))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 3) {
        return Ok(Value::Error(e));
    }
    let rate = match arg_num(ctx, args, 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let flows = match collect_flows(ctx, &args[1], &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(f) => f,
    };
    if flows.is_empty() {
        return Ok(Value::Error(CalcError::Value));
    }
    let d0 = flows[0].1;
    if flows.iter().any(|&(_, d)| d < d0) {
        return Ok(Value::Error(CalcError::Num));
    }
    let dates: Vec<i64> = flows.iter().map(|&(_, d)| d).collect();
    let amounts: Vec<f64> = flows.iter().map(|&(v, _)| v).collect();
    match finance::xnpv(rate, &dates, &amounts) {
        Some(v) => Ok(Value::Number(v)),
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
        // ≈ 2086.65.
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
            "=XNPV(0.09,A1:A5,B1:B5)",
        );
        assert!((n(&v) - 2086.65).abs() < 0.05, "got {}", n(&v));
    }

    #[test]
    fn one_year_offset_exact() {
        // -1000 + 1100/1.1 = 0.
        let v = eval_with(
            &[
                ("A1", (-1000.0).into()),
                ("A2", 1100.0.into()),
                ("B1", 45000.0.into()),
                ("B2", 45365.0.into()),
            ],
            "=XNPV(0.1,A1:A2,B1:B2)",
        );
        assert!(n(&v).abs() < 1e-9, "got {}", n(&v));
    }

    #[test]
    fn zero_rate_sums() {
        let v = eval_with(
            &[
                ("A1", 100.0.into()),
                ("A2", 200.0.into()),
                ("B1", 45000.0.into()),
                ("B2", 45100.0.into()),
            ],
            "=XNPV(0,A1:A2,B1:B2)",
        );
        assert_eq!(n(&v), 300.0);
    }

    #[test]
    fn first_flow_not_discounted() {
        // Single flow at t0 returns itself.
        let v = eval_with(
            &[("A1", (-500.0).into()), ("B1", 45000.0.into())],
            "=XNPV(0.5,A1:A1,B1:B1)",
        );
        assert_eq!(n(&v), -500.0);
    }

    #[test]
    fn array_literals() {
        let v = eval("=XNPV(0.1,{-1000,1100},{45000,45365})");
        assert!(n(&v).abs() < 1e-9, "got {}", n(&v));
    }

    #[test]
    fn length_mismatch_num() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", 45000.0.into()),
            ],
            "=XNPV(0.1,A1:A2,B1:B1)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn date_before_first_num() {
        let v = eval_with(
            &[
                ("A1", (-100.0).into()),
                ("A2", 200.0.into()),
                ("B1", 45100.0.into()),
                ("B2", 45000.0.into()),
            ],
            "=XNPV(0.1,A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn rate_minus_one_num() {
        // SPEC-OPEN: rate <= -1 assumed #NUM! (outside discount domain).
        let v = eval_with(
            &[
                ("A1", (-100.0).into()),
                ("A2", 200.0.into()),
                ("B1", 45000.0.into()),
                ("B2", 45100.0.into()),
            ],
            "=XNPV(-1,A1:A2,B1:B2)",
        );
        assert_eq!(e(&v), CalcError::Num);
    }

    #[test]
    fn text_member_drops_pair() {
        // SPEC-OPEN: non-numeric range members drop their pair.
        let v = eval_with(
            &[
                ("A1", (-100.0).into()),
                ("A2", "x".into()),
                ("A3", 220.0.into()),
                ("B1", 45000.0.into()),
                ("B2", 45100.0.into()),
                ("B3", 45200.0.into()),
            ],
            "=XNPV(0,A1:A3,B1:B3)",
        );
        assert_eq!(n(&v), 120.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("B1", 45000.0.into())],
            "=XNPV(0.1,A1:A1,B1:B1)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn non_numeric_rate_value_error() {
        assert_eq!(e(&eval(r#"=XNPV("x",{100},{45000})"#)), CalcError::Value);
    }

    #[test]
    fn unsorted_dates_allowed() {
        // Dates need not be chronological (all >= first).
        let v = eval("=XNPV(0,{-100,50,80},{45000,45200,45100})");
        assert_eq!(n(&v), 30.0);
    }
}
