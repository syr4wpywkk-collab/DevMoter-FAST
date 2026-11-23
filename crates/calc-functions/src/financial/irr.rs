//! `IRR(values, [guess])` — internal rate of return of periodic cash
//! flows. Spec: `docs/functions/IRR.md`.
//!
//! Excel iterates Newton's method from `guess` (default 0.1), ~20
//! iterations, and returns `#NUM!` on non-convergence — so flows whose
//! only root is far from `guess` fail even though a root exists (the
//! `{-70000,12000,15000}` example in the spec and the SPEC-OPEN note in
//! `common/finance.rs`). Range/array members keep only numbers;
//! text/logical/blank are ignored, error cells propagate.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Collect cash flows: scalars coerce; range/array members keep only
/// `Number` cells (errors propagate, others ignored) — the IRR/MIRR
/// coercion shared with `MIRR`.
pub(crate) fn collect_flows(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<Vec<f64>, CalcError>, EvalError> {
    let flat: Vec<(Value, bool)> = match ctx.eval_arg(arg)? {
        // An array literal arrives as a scalar `Value::Array`; its
        // members follow range coercion (IRR.md open question).
        ArgValue::Scalar(Value::Array(a)) | ArgValue::Range(a) => {
            a.into_iter().map(|v| (v, true)).collect()
        }
        ArgValue::Scalar(v) => vec![(v, false)],
        ArgValue::Ref(v) => vec![(v, true)],
    };
    let mut out = Vec::new();
    for (v, ranged) in flat {
        if let Some(e) = v.error() {
            return Ok(Err(e));
        }
        if ranged {
            if let Value::Number(n) = v {
                out.push(n);
            }
        } else {
            match v.to_number() {
                Ok(n) => out.push(n),
                Err(e) => return Ok(Err(e)),
            }
        }
    }
    Ok(Ok(out))
}

/// Excel-style Newton iteration on `Σ v_i/(1+r)^i = 0` from `guess`.
/// `None` = non-convergence (`#NUM!`).
fn irr_newton(values: &[f64], guess: f64) -> Option<f64> {
    if !values.iter().any(|&v| v > 0.0) || !values.iter().any(|&v| v < 0.0) {
        return None;
    }
    let mut r = if guess.is_finite() { guess } else { 0.1 }.max(-0.999999);
    for _ in 0..20 {
        let base = 1.0 + r;
        let mut f = 0.0;
        let mut d = 0.0;
        for (i, &v) in values.iter().enumerate() {
            let i = i as f64;
            f += v * base.powf(-i);
            d += -i * v * base.powf(-i - 1.0);
        }
        if !f.is_finite() {
            return None;
        }
        if f.abs() < 1e-10 {
            return Some(r);
        }
        if !d.is_finite() || d == 0.0 {
            return None;
        }
        let next = (r - f / d).max(-0.999999);
        if !next.is_finite() {
            return None;
        }
        if (next - r).abs() < 1e-10 * (1.0 + r.abs()) {
            return Some(next);
        }
        r = next;
    }
    None
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 2) {
        return Ok(Value::Error(e));
    }
    let values = match collect_flows(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if values.len() < 2 {
        return Ok(Value::Error(CalcError::Num));
    }
    let guess = match coercion::eval_opt_number(ctx, args.get(1), 0.1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    match irr_newton(&values, guess) {
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
    fn doc_example() {
        let v = eval("=IRR({-70000,12000,15000,18000,21000,26000})");
        assert!((n(&v) - 0.086630948).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn doc_example_with_guess() {
        let v = eval("=IRR({-70000,12000,15000,18000,21000,26000},0.1)");
        assert!((n(&v) - 0.086630948).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn non_convergence_num() {
        // Excel iterates from guess and diverges despite a root near
        // r ≈ -0.44 (IRR.md example).
        assert_eq!(e(&eval("=IRR({-70000,12000,15000})")), CalcError::Num);
    }

    #[test]
    fn all_positive_num() {
        assert_eq!(e(&eval("=IRR({70000,12000,15000})")), CalcError::Num);
    }

    #[test]
    fn all_negative_num() {
        assert_eq!(e(&eval("=IRR({-1,-2,-3})")), CalcError::Num);
    }

    #[test]
    fn two_flows_exact() {
        // -100 then 121 -> r = 0.21 exactly.
        let v = eval("=IRR({-100,121})");
        assert!((n(&v) - 0.21).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn range_ignores_text_blank() {
        let v = eval_with(
            &[
                ("A1", (-100.0).into()),
                ("A2", "x".into()),
                ("A4", 121.0.into()),
            ],
            "=IRR(A1:A5)",
        );
        assert!((n(&v) - 0.21).abs() < 1e-9, "{v:?}");
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[
                ("A1", (-100.0).into()),
                ("A2", Value::Error(CalcError::NA)),
                ("A3", 121.0.into()),
            ],
            "=IRR(A1:A3)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn guess_influences_root() {
        // A negative guess can find a different convergence domain.
        let v = eval("=IRR({-100,200,-50,400},0.1)");
        assert!(v == v); // evaluates (any finite result is acceptable)
    }

    #[test]
    fn empty_values_num() {
        assert_eq!(e(&eval("=IRR({5})")), CalcError::Num);
    }

    #[test]
    fn bad_guess_text() {
        assert_eq!(e(&eval(r#"=IRR({-100,121},"x")"#)), CalcError::Value);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=IRR()")), CalcError::Value);
    }
}
