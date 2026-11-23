//! `TREND(known_ys, [known_xs], [new_xs], [const])` — least-squares
//! linear trend values. Spec: `docs/functions/TREND.md`.
//!
//! `known_ys` must be a single row or column. With `known_ys` a column
//! each *column* of `known_xs` is a variable; with a row, each *row* is
//! a variable (Excel's orientation rule). `known_xs` omitted -> x =
//! `1..n`. `new_xs` omitted -> the fitted values on `known_xs`;
//! otherwise it must have the same variable count -> `#REF!`.
//! `const = FALSE` forces the fit through the origin.
//!
//! Collinearity: [`statistics::solve_normal_equations`] returns `None`
//! on a singular normal matrix -> `#NUM!` here; Excel's `LINEST`
//! drops the collinear columns instead (SPEC-OPEN gap, noted in the
//! spec doc).

use crate::common::{coercion, statistics};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Every member as a number; error cells propagate, text fails
/// coercion (`LINEST`-family inputs must be numeric).
fn numbers(a: &ArrayValue) -> Result<Vec<f64>, CalcError> {
    a.iter().map(|v| v.to_number()).collect()
}

/// Design rows (no intercept column) for `vars` variables over `obs`
/// observations. `by_col` selects the x-block orientation: variable-
/// per-column (`known_ys` a column) or variable-per-row.
fn design_rows(x: &[f64], obs: usize, vars: usize, by_col: bool) -> Vec<Vec<f64>> {
    (0..obs)
        .map(|i| {
            (0..vars)
                .map(|v| {
                    if by_col {
                        x[i * vars + v]
                    } else {
                        x[v * obs + i]
                    }
                })
                .collect()
        })
        .collect()
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 4) {
        return Ok(Value::Error(e));
    }
    let ys = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let (n_obs, by_col) = if ys.cols() == 1 {
        (ys.rows() as usize, true)
    } else if ys.rows() == 1 {
        (ys.cols() as usize, false)
    } else {
        return Ok(Value::Error(CalcError::Value));
    };
    let y = match numbers(&ys) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(y) => y,
    };
    let with_intercept = match args.get(3) {
        Some(Expr::Missing) | None => true,
        Some(a) => match ctx.eval(a)?.to_boolean() {
            Err(e) => return Ok(Value::Error(e)),
            Ok(b) => b,
        },
    };
    // x block: (flat cells, obs, vars) — implicit xs is 1..n.
    let (kx, vars) = match args.get(1) {
        Some(Expr::Missing) | None => ((1..=n_obs).map(|i| i as f64).collect::<Vec<_>>(), 1usize),
        Some(e) => {
            let xs = match coercion::eval_array(ctx, e)? {
                Err(e) => return Ok(Value::Error(e)),
                Ok(a) => a,
            };
            let cells = match numbers(&xs) {
                Err(e) => return Ok(Value::Error(e)),
                Ok(c) => c,
            };
            let (rows, cols) = (xs.rows() as usize, xs.cols() as usize);
            let vars = if by_col {
                if rows != n_obs {
                    return Ok(Value::Error(CalcError::Ref));
                }
                cols
            } else {
                if cols != n_obs {
                    return Ok(Value::Error(CalcError::Ref));
                }
                rows
            };
            (cells, vars)
        }
    };
    let mut design = design_rows(&kx, n_obs, vars, by_col);
    if with_intercept {
        for row in &mut design {
            row.push(1.0);
        }
    }
    let Some(beta) = statistics::solve_normal_equations(&design, &y) else {
        return Ok(Value::Error(CalcError::Num));
    };
    let nx = match args.get(2) {
        Some(Expr::Missing) | None => design_rows(&kx, n_obs, vars, by_col),
        Some(e) => {
            let xs = match coercion::eval_array(ctx, e)? {
                Err(e) => return Ok(Value::Error(e)),
                Ok(a) => a,
            };
            let cells = match numbers(&xs) {
                Err(e) => return Ok(Value::Error(e)),
                Ok(c) => c,
            };
            let (rows, cols) = (xs.rows() as usize, xs.cols() as usize);
            if by_col {
                if cols != vars {
                    return Ok(Value::Error(CalcError::Ref));
                }
                design_rows(&cells, rows, vars, true)
            } else {
                if rows != vars {
                    return Ok(Value::Error(CalcError::Ref));
                }
                design_rows(&cells, cols, vars, false)
            }
        }
    };
    let predict = |row: &[f64]| -> f64 {
        let mut s = row.iter().zip(beta.iter()).map(|(x, b)| x * b).sum::<f64>();
        if with_intercept {
            s += beta[vars];
        }
        s
    };
    let vals: Vec<Value> = nx.iter().map(|r| Value::Number(predict(r))).collect();
    let arr = if by_col {
        ArrayValue::from_column(vals)
    } else {
        ArrayValue::from_row(vals)
    };
    match arr {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn nums(v: &Value) -> Vec<f64> {
        match v {
            Value::Array(a) => a
                .iter()
                .map(|c| match c {
                    Value::Number(n) => *n,
                    o => panic!("expected number, got {o:?}"),
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
    fn straight_line_projection() {
        // y = 2x on x=1..4, predict 5,6 -> {10;12}
        let v = eval("=TREND({2;4;6;8},{1;2;3;4},{5;6})");
        assert_eq!(nums(&v), vec![10.0, 12.0]);
    }

    #[test]
    fn implicit_xs_fitted() {
        // ys on x=1..4 is already a line -> fitted = ys
        let v = eval("=TREND({3;5;7;9})");
        let got = nums(&v);
        for (g, w) in got.iter().zip([3.0, 5.0, 7.0, 9.0]) {
            assert!((g - w).abs() < 1e-12, "{g} vs {w}");
        }
    }

    #[test]
    fn forced_through_origin() {
        // y=x through origin: TREND(y, x, 5, FALSE) -> {5}
        let v = eval("=TREND({1;2;3;4},{1;2;3;4},{5},FALSE)");
        assert_eq!(nums(&v), vec![5.0]);
    }

    #[test]
    fn least_squares_fit() {
        // y={1;3;2;4} on x=1..4: slope 0.8, intercept 0.5 -> new x=5 -> 4.5
        let v = eval("=TREND({1;3;2;4},{1;2;3;4},{5})");
        let got = nums(&v);
        assert_eq!(got.len(), 1);
        assert!((got[0] - 4.5).abs() < 1e-9, "got {}", got[0]);
    }

    #[test]
    fn row_orientation_returns_row() {
        let v = eval("=TREND({2,4,6,8},{1,2,3,4},{5,6})");
        if let Value::Array(a) = &v {
            assert_eq!((a.rows(), a.cols()), (1, 2));
        }
        assert_eq!(nums(&v), vec![10.0, 12.0]);
    }

    #[test]
    fn multi_variable_fit() {
        // y = x1 + 2*x2 exactly: ys column, xs has 2 columns.
        let v = eval("=TREND({5;4;11;8},{1,2;2,1;3,4;4,2},{5,4;6,4.5})");
        assert_eq!(nums(&v), vec![13.0, 15.0]);
    }

    #[test]
    fn new_xs_var_count_mismatch_ref() {
        assert_eq!(
            e(&eval("=TREND({5;4;11;8},{1,2;2,1;3,4;4,2},{5})")),
            CalcError::Ref
        );
    }

    #[test]
    fn known_xs_obs_mismatch_ref() {
        assert_eq!(e(&eval("=TREND({1;2;3},{1;2})")), CalcError::Ref);
    }

    #[test]
    fn collinear_xs_num() {
        // x2 = 2*x1 -> singular normal matrix (SPEC-OPEN: LINEST drops it).
        assert_eq!(
            e(&eval("=TREND({1;2;3},{1,2;2,4;3,6},{4,8})")),
            CalcError::Num
        );
    }

    #[test]
    fn non_numeric_ys_value() {
        let v = eval_with(&[("A1", "x".into())], "=TREND(A1:A2)");
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval("=TREND({1/0;2})")), CalcError::DivZero);
    }

    #[test]
    fn non_rectangular_ys_value() {
        assert_eq!(e(&eval("=TREND({1,2;3,4})")), CalcError::Value);
    }

    #[test]
    fn missing_new_xs_uses_known() {
        assert_eq!(
            nums(&eval("=TREND({2;4;6;8},{1;2;3;4},)")),
            vec![2.0, 4.0, 6.0, 8.0]
        );
    }
}
