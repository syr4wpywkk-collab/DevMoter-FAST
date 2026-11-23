//! `GROWTH(known_ys, [known_xs], [new_xs], [const])` — exponential
//! fit `y = b·m^x` via least squares on `LN(y)`; predicts `new_xs`.
//! Spec: `docs/functions/GROWTH.md`.
//!
//! `new_xs` defaults to `known_xs`; `known_xs` defaults to `1..=n`.
//! `const = FALSE` forces `b = 1` (slope through the origin on the log
//! scale). A vector `new_xs` returns an array with the argument's
//! orientation. `y <= 0` is `#NUM!`; `known_xs` length mismatch is
//! `#REF!` (documented); zero x-variance is `#NUM!` (SPEC-OPEN: the
//! error kind is not pinned by the spec).

use crate::common::{coercion, statistics};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// A series argument: numeric members plus the array orientation
/// (used to shape a vector `new_xs` result).
struct Series {
    nums: Vec<f64>,
    rows: u32,
    cols: u32,
}

/// Numbers of a required series argument, preserving the array shape
/// for the output and requiring every member numeric.
fn series(ctx: &mut EvalContext<'_>, arg: &Expr) -> Result<Result<Series, CalcError>, EvalError> {
    let arr = match coercion::eval_array(ctx, arg)? {
        Err(e) => return Ok(Err(e)),
        Ok(a) => a,
    };
    let (rows, cols) = (arr.rows(), arr.cols());
    if let Some(e) = arr.cells().iter().find_map(|v| v.error()) {
        return Ok(Err(e));
    }
    // A 1x1 argument follows direct-scalar coercion (text "5" counts);
    // larger arrays ignore non-numeric members like the paired
    // functions (SPEC-OPEN: pair-skip rules for GROWTH).
    let out: Vec<f64> = if arr.len() == 1 {
        match arr.cells()[0].to_number() {
            Ok(x) => vec![x],
            Err(e) => return Ok(Err(e)),
        }
    } else {
        arr.cells()
            .iter()
            .filter_map(|v| match v {
                Value::Number(n) => Some(*n),
                _ => None,
            })
            .collect()
    };
    Ok(Ok(Series {
        nums: out,
        rows,
        cols,
    }))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 4) {
        return Ok(Value::Error(e));
    }
    let ys = match series(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => s.nums,
    };
    if ys.is_empty() || ys.iter().any(|&y| y <= 0.0) {
        return Ok(Value::Error(CalcError::Num));
    }
    let xs: Vec<f64> = if args.len() < 2 {
        (1..=ys.len()).map(|i| i as f64).collect()
    } else {
        let xs = match series(ctx, &args[1])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(s) => s.nums,
        };
        if xs.len() != ys.len() {
            return Ok(Value::Error(CalcError::Ref));
        }
        xs
    };
    let (new_xs, rows, cols) = if args.len() < 3 {
        (xs.clone(), 1, xs.len() as u32)
    } else {
        match series(ctx, &args[2])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(s) => (s.nums, s.rows, s.cols),
        }
    };
    let fit_const = if args.len() < 4 {
        true
    } else {
        match ctx.eval(&args[3])?.to_boolean() {
            Err(e) => return Ok(Value::Error(e)),
            Ok(b) => b,
        }
    };
    // Least squares on (x, ln y): slope = ln m, intercept = ln b.
    let ln_ys: Vec<f64> = ys.iter().map(|y| y.ln()).collect();
    let pairs: Vec<(f64, f64)> = xs.iter().copied().zip(ln_ys).collect();
    let st = statistics::pair_stats(&pairs);
    let (ln_m, ln_b) = if fit_const {
        if st.sxx == 0.0 {
            return Ok(Value::Error(CalcError::Num));
        }
        (st.sxy / st.sxx, st.mean_y - st.sxy / st.sxx * st.mean_x)
    } else {
        // b = 1: ln y = x·ln m through the origin.
        let sxx: f64 = pairs.iter().map(|(x, _)| x * x).sum();
        if sxx == 0.0 {
            return Ok(Value::Error(CalcError::Num));
        }
        let sxy: f64 = pairs.iter().map(|(x, y)| x * y).sum();
        (sxy / sxx, 0.0)
    };
    let m = ln_m.exp();
    let b = ln_b.exp();
    let preds: Vec<Value> = new_xs
        .iter()
        .map(|x| Value::Number(b * m.powf(*x)))
        .collect();
    if preds.len() == 1 {
        return Ok(preds.into_iter().next().unwrap());
    }
    match ArrayValue::new(rows, cols, preds) {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
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

    fn a(v: &Value) -> Vec<f64> {
        match v {
            Value::Array(a) => a
                .cells()
                .iter()
                .map(|c| match c {
                    Value::Number(n) => *n,
                    o => panic!("expected number cell, got {o:?}"),
                })
                .collect(),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn textbook_example() {
        // Microsoft example: ~320196.7 at month 17.
        assert!(
            (n(&eval(
                "=GROWTH({33100,47300,69000,102000,150000,220000},{11,12,13,14,15,16},17)"
            )) - 320196.7)
                .abs()
                < 0.1
        );
    }

    #[test]
    fn powers_of_two() {
        assert!((n(&eval("=GROWTH({2,4,8},{1,2,3},{4})")) - 16.0).abs() < 1e-12);
    }

    #[test]
    fn identity_echo() {
        // Omitted xs/new_xs returns fitted values at 1..4: exact for
        // y = 2^(x-1).
        let v = a(&eval("=GROWTH({1,2,4,8})"));
        for (got, want) in v.iter().zip([1.0, 2.0, 4.0, 8.0]) {
            assert!((got - want).abs() < 1e-12, "{v:?}");
        }
    }

    #[test]
    fn vector_new_xs() {
        let v = a(&eval("=GROWTH({2,4,8},{1,2,3},{4,5})"));
        for (got, want) in v.iter().zip([16.0, 32.0]) {
            assert!((got - want).abs() < 1e-12, "{v:?}");
        }
    }

    #[test]
    fn nonpositive_y_num() {
        assert_eq!(e(&eval("=GROWTH({0,1},{1,2})")), CalcError::Num);
        assert_eq!(e(&eval("=GROWTH({-1,1},{1,2})")), CalcError::Num);
    }

    #[test]
    fn size_mismatch_ref() {
        assert_eq!(e(&eval("=GROWTH({1,2},{1,2,3})")), CalcError::Ref);
    }

    #[test]
    fn const_false_through_origin() {
        // y = 2^x exactly: b forced to 1 still fits (b = 1 here).
        assert_eq!(n(&eval("=GROWTH({2,4,8},{1,2,3},{4},FALSE)")), 16.0);
    }

    #[test]
    fn const_false_shifts_fit() {
        // y = 2^(x-1): forcing b=1 changes the prediction.
        let with_b = n(&eval("=GROWTH({1,2,4},{1,2,3},{4})"));
        let no_b = n(&eval("=GROWTH({1,2,4},{1,2,3},{4},FALSE)"));
        assert!((with_b - 8.0).abs() < 1e-12);
        // ln m = Σx·ln y / Σx² = 8·ln 2/14 -> pred(4) = 2^(16/7)
        assert!((no_b - 2f64.powf(16.0 / 7.0)).abs() < 1e-12);
    }

    #[test]
    fn ranges_form() {
        let v = eval_with(
            &[
                ("A1", 2.0.into()),
                ("A2", 4.0.into()),
                ("A3", 8.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
            ],
            "=GROWTH(A1:A3,B1:B3,4)",
        );
        assert!((n(&v) - 16.0).abs() < 1e-12);
    }

    #[test]
    fn error_member_propagates() {
        let v = eval_with(
            &[("A1", 2.0.into()), ("A2", Value::Error(CalcError::NA))],
            "=GROWTH(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn scalar_new_xs() {
        assert!((n(&eval("=GROWTH({2,4,8},{1,2,3},4)")) - 16.0).abs() < 1e-12);
    }
}
