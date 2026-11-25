//! `LINEST(known_ys, [known_xs], [const], [stats])` — least-squares
//! linear regression returning the coefficient row
//! `{m_p, ..., m1, b}` and, with `stats=TRUE`, the 5 x (p+1)
//! statistics block. Spec: `docs/functions/LINEST.md`.
//!
//! The fit is shared with `LOGEST` via [`run`]: `LOGEST` fits the same
//! normal equations on `ln(y)`. Implementation notes where the spec
//! doc leaves Excel's behavior open (SPEC-OPEN in LINEST.md):
//! - Non-numeric cells inside `known_ys`/`known_xs` return `#VALUE!`
//!   (the ignore-pair alternative is unverified); error cells
//!   propagate.
//! - Shape mismatches return `#REF!`, matching the spec doc's note.
//! - Collinear columns are detected by pivot tolerance during
//!   elimination; a dropped column reports coefficient `0` and
//!   standard error `0`, and reduces the regression degrees of
//!   freedom.
//! - The stats block is 5 rows x (p+1) columns (Excel's on-sheet
//!   layout). The spec doc's "(p+1) x 5" phrasing is read as the
//!   transposed description of the same block.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Pivot tolerance for collinearity detection (relative to the largest
/// diagonal of `XᵀX`). Excel's threshold is undocumented (SPEC-OPEN).
const PIVOT_TOL: f64 = 1e-10;

/// All cells of `a` as row-major `f64` rows. Non-numeric cells are
/// `#VALUE!`; error cells propagate.
fn numeric_matrix(a: &ArrayValue) -> Result<Vec<Vec<f64>>, CalcError> {
    let mut out = Vec::with_capacity(a.rows() as usize);
    for r in 0..a.rows() {
        let mut row = Vec::with_capacity(a.cols() as usize);
        for c in 0..a.cols() {
            match a.get(r, c) {
                Some(Value::Number(v)) => row.push(*v),
                Some(Value::Error(e)) => return Err(*e),
                _ => return Err(CalcError::Value),
            }
        }
        out.push(row);
    }
    Ok(out)
}

/// Columns of independent variables: `n` rows of `p` values each,
/// in input order (`m1` first).
struct Design {
    n: usize,
    /// `x_cols[j][i]` = value of variable `j` for observation `i`.
    x_cols: Vec<Vec<f64>>,
    y: Vec<f64>,
}

/// Normalize `known_ys`/`known_xs` into a design. `ys` may be a column
/// (each `xs` column a variable) or a row (each `xs` row a variable);
/// anything else is `#VALUE!`, mismatched lengths `#REF!`.
fn design(ys: &ArrayValue, xs: Option<&ArrayValue>) -> Result<Design, CalcError> {
    let ym = numeric_matrix(ys)?;
    let (y, ys_is_col) = if ys.cols() == 1 {
        (ym.iter().map(|r| r[0]).collect::<Vec<_>>(), true)
    } else if ys.rows() == 1 {
        (ym[0].clone(), false)
    } else {
        return Err(CalcError::Value);
    };
    let n = y.len();

    let x_cols = match xs {
        None => vec![(1..=n).map(|i| i as f64).collect()],
        Some(a) => {
            let xm = numeric_matrix(a)?;
            if ys_is_col {
                if xm.len() != n {
                    return Err(CalcError::Ref);
                }
                (0..a.cols() as usize)
                    .map(|c| xm.iter().map(|r| r[c]).collect())
                    .collect()
            } else {
                if xm.first().is_none_or(|r| r.len() != n) {
                    return Err(CalcError::Ref);
                }
                xm
            }
        }
    };
    Ok(Design { n, x_cols, y })
}

/// Indices of columns of `g` that survive pivoting (rank detection via
/// Gaussian elimination on the symmetric normal matrix).
fn independent_cols(g: &[Vec<f64>]) -> Vec<usize> {
    let m = g.len();
    let mut a = g.to_vec();
    let scale = (0..m)
        .map(|i| a[i][i].abs())
        .fold(0.0f64, f64::max)
        .max(1.0);
    let tol = PIVOT_TOL * scale;
    let mut kept = Vec::new();
    let mut row = 0;
    for c in 0..m {
        if row >= m {
            break;
        }
        let Some(piv) = (row..m).max_by(|&r, &s| a[r][c].abs().total_cmp(&a[s][c].abs())) else {
            break;
        };
        if a[piv][c].abs() <= tol {
            continue;
        }
        a.swap(row, piv);
        for i in (row + 1)..m {
            let f = a[i][c] / a[row][c];
            for j in c..m {
                a[i][j] -= f * a[row][j];
            }
        }
        kept.push(c);
        row += 1;
    }
    kept
}

/// Solve `k β = z` and return `(β, diag(K⁻¹))` for the `kept` columns.
/// Gauss-Jordan with partial pivoting on the reduced matrix.
fn solve_kept(g: &[Vec<f64>], z: &[f64], kept: &[usize]) -> (Vec<f64>, Vec<f64>) {
    let m = kept.len();
    // Augment [K | z | I].
    let mut a: Vec<Vec<f64>> = (0..m)
        .map(|i| {
            let mut r: Vec<f64> = kept.iter().map(|&j| g[kept[i]][j]).collect();
            r.push(z[kept[i]]);
            r.extend((0..m).map(|j| (i == j) as u8 as f64));
            r
        })
        .collect();
    for col in 0..m {
        let piv = (col..m)
            .max_by(|&r, &s| a[r][col].abs().total_cmp(&a[s][col].abs()))
            .unwrap_or(col);
        a.swap(col, piv);
        let d = a[col][col];
        if d == 0.0 {
            // Numerically singular despite rank detection: leave zeros.
            continue;
        }
        for v in a[col].iter_mut() {
            *v /= d;
        }
        let pivot: Vec<f64> = a[col].clone();
        for (i, row) in a.iter_mut().enumerate() {
            if i == col {
                continue;
            }
            let f = row[col];
            if f != 0.0 {
                for (v, p) in row.iter_mut().zip(pivot.iter()) {
                    *v -= f * p;
                }
            }
        }
    }
    let beta = (0..m).map(|i| a[i][m]).collect();
    let inv_diag = (0..m).map(|i| a[i][m + 1 + i]).collect();
    (beta, inv_diag)
}

/// Result of the regression fit, before output mapping.
struct Fit {
    /// Coefficients in design order `[m1..mp, b]` (`b = 0` when
    /// `const = FALSE`).
    coef: Vec<f64>,
    /// Standard errors aligned with `coef`; `None` where `#N/A`.
    se: Vec<Option<f64>>,
    r2: Option<f64>,
    sey: Option<f64>,
    f_stat: Option<f64>,
    df_resid: f64,
    ss_reg: f64,
    ss_resid: f64,
}

/// Least-squares fit over the design columns plus an optional
/// intercept column appended last.
fn fit(d: &Design, with_const: bool) -> Fit {
    let p = d.x_cols.len();
    let k = p + usize::from(with_const);

    // Normal equations G β = z.
    let mut g = vec![vec![0.0; k]; k];
    let mut z = vec![0.0; k];
    let col = |j: usize| -> Vec<f64> {
        if j < p {
            d.x_cols[j].clone()
        } else {
            vec![1.0; d.n]
        }
    };
    let cols: Vec<Vec<f64>> = (0..k).map(col).collect();
    for i in 0..k {
        for j in 0..=i {
            let s: f64 = (0..d.n).map(|r| cols[i][r] * cols[j][r]).sum();
            g[i][j] = s;
            g[j][i] = s;
        }
        z[i] = (0..d.n).map(|r| cols[i][r] * d.y[r]).sum();
    }

    let kept = independent_cols(&g);
    let (beta_kept, inv_diag) = solve_kept(&g, &z, &kept);
    let rank = kept.len();

    let mut coef = vec![0.0; k];
    let mut inv = vec![0.0; k];
    for (idx, &j) in kept.iter().enumerate() {
        coef[j] = beta_kept[idx];
        inv[j] = inv_diag[idx];
    }

    // Residuals and sums of squares.
    let mut sse = 0.0;
    for r in 0..d.n {
        let pred: f64 = (0..k).map(|j| coef[j] * cols[j][r]).sum();
        let e = d.y[r] - pred;
        sse += e * e;
    }
    let sst: f64 = if with_const {
        let mean = d.y.iter().sum::<f64>() / d.n as f64;
        d.y.iter().map(|y| (y - mean) * (y - mean)).sum()
    } else {
        d.y.iter().map(|y| y * y).sum()
    };
    // Regression SS; clamp the tiny negative FP residue.
    let ss_reg = (sst - sse).max(0.0);
    let df_resid = d.n as f64 - rank as f64;
    let df_reg = rank as f64 - f64::from(with_const);

    let ms_resid = if df_resid > 0.0 {
        Some(sse / df_resid)
    } else {
        None
    };
    let se: Vec<Option<f64>> = (0..k)
        .map(|j| {
            if !kept.contains(&j) {
                // Dropped column: coefficient and SE are 0 (SPEC-OPEN).
                Some(0.0)
            } else if !with_const && j == k - 1 {
                None
            } else {
                ms_resid.map(|ms| (ms * inv[j]).sqrt())
            }
        })
        .collect();
    let r2 = if sst > 0.0 { Some(ss_reg / sst) } else { None };
    let sey = ms_resid.map(f64::sqrt);
    let f_stat = match (ms_resid, df_reg > 0.0) {
        (Some(ms), true) => Some((ss_reg / df_reg) / ms),
        _ => None,
    };
    Fit {
        coef,
        se,
        r2,
        sey,
        f_stat,
        df_resid,
        ss_reg,
        ss_resid: sse,
    }
}

fn na() -> Value {
    Value::Error(CalcError::NA)
}

fn num(v: Option<f64>) -> Value {
    v.map_or_else(na, Value::Number)
}

/// Shared LINEST/LOGEST driver. `log_scale` fits `ln(y)` and reports
/// growth factors `exp(β)` for the slope slots; the intercept slot is
/// `exp(b)` (`1` when `const = FALSE`). Standard errors in the stats
/// block are those of the underlying (log-)linear fit — for LOGEST that
/// is `se(ln m)`, `se(ln b)` (Excel's exact convention is SPEC-OPEN in
/// LOGEST.md).
pub(crate) fn run(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    log_scale: bool,
) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 4) {
        return Ok(Value::Error(e));
    }
    let ys = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let xs = match args.get(1) {
        None => None,
        Some(arg) => match coercion::eval_array(ctx, arg)? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(a) => Some(a),
        },
    };
    let with_const = match args.get(2) {
        None => true,
        Some(arg) => match ctx.eval(arg)?.to_boolean() {
            Err(e) => return Ok(Value::Error(e)),
            Ok(b) => b,
        },
    };
    let want_stats = match args.get(3) {
        None => false,
        Some(arg) => match ctx.eval(arg)?.to_boolean() {
            Err(e) => return Ok(Value::Error(e)),
            Ok(b) => b,
        },
    };

    let mut d = match design(&ys, xs.as_ref()) {
        Err(e) => return Ok(Value::Error(e)),
        Ok(d) => d,
    };
    if log_scale {
        for y in &mut d.y {
            if *y <= 0.0 {
                // SPEC-OPEN in LOGEST.md: `#VALUE!` vs `#NUM!`.
                return Ok(Value::Error(CalcError::Value));
            }
            *y = y.ln();
        }
    }

    let f = fit(&d, with_const);
    let p = d.x_cols.len();
    let out = |v: f64| if log_scale { v.exp() } else { v };

    // Output order: {m_p, ..., m1, b}.
    let mut coef_row: Vec<Value> = (0..p)
        .rev()
        .map(|j| Value::Number(out(f.coef[j])))
        .collect();
    let mut se_row: Vec<Value> = (0..p).rev().map(|j| num(f.se[j])).collect();
    if with_const {
        coef_row.push(Value::Number(out(f.coef[p])));
        se_row.push(num(f.se[p]));
    } else {
        coef_row.push(Value::Number(if log_scale { 1.0 } else { 0.0 }));
        se_row.push(na());
    }

    if !want_stats {
        return match ArrayValue::from_row(coef_row) {
            Ok(a) => Ok(Value::Array(a)),
            Err(e) => Ok(Value::Error(e)),
        };
    }

    let width = p + 1;
    let mut cells = coef_row;
    cells.extend(se_row);
    cells.push(num(f.r2));
    cells.push(num(f.sey));
    cells.extend(std::iter::repeat_with(na).take(width - 2));
    cells.push(num(f.f_stat));
    cells.push(Value::Number(f.df_resid));
    cells.extend(std::iter::repeat_with(na).take(width - 2));
    cells.push(Value::Number(f.ss_reg));
    cells.push(Value::Number(f.ss_resid));
    cells.extend(std::iter::repeat_with(na).take(width - 2));
    match ArrayValue::new(5, width as u32, cells) {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    run(ctx, args, false)
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn cells(v: &Value) -> Vec<Value> {
        match v {
            Value::Array(a) => a.iter().cloned().collect(),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn nums(v: &Value) -> Vec<f64> {
        cells(v)
            .iter()
            .map(|c| match c {
                Value::Number(n) => *n,
                o => panic!("expected number cell, got {o:?}"),
            })
            .collect()
    }

    fn shape(v: &Value) -> (u32, u32) {
        match v {
            Value::Array(a) => (a.rows(), a.cols()),
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
    fn doc_example_exact_fit() {
        // LINEST({2;4;6;8},{1;2;3;4}) -> {2, 0}.
        assert_eq!(nums(&eval("=LINEST({2;4;6;8},{1;2;3;4})")), vec![2.0, 0.0]);
    }

    #[test]
    fn doc_example_implicit_xs() {
        // A1:A4 = 3,5,7,9 -> {2, 1}.
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 5.0.into()),
                ("A3", 7.0.into()),
                ("A4", 9.0.into()),
            ],
            "=LINEST(A1:A4)",
        );
        let c = nums(&v);
        assert!((c[0] - 2.0).abs() < 1e-12);
        assert!((c[1] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn doc_example_no_const() {
        assert_eq!(
            nums(&eval("=LINEST({1;2;3;4},{1;2;3;4},FALSE)")),
            vec![1.0, 0.0]
        );
    }

    #[test]
    fn noisy_fit() {
        // y = 2x + noise: x=1..4, y=3,5,6,9 -> m=1.9, b=1.0.
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 5.0.into()),
                ("A3", 6.0.into()),
                ("A4", 9.0.into()),
            ],
            "=LINEST(A1:A4)",
        );
        let c = nums(&v);
        assert!((c[0] - 1.9).abs() < 1e-9);
        assert!((c[1] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn stats_block_shape_and_r2() {
        let v = eval_with(
            &[
                ("A1", 3.0.into()),
                ("A2", 5.0.into()),
                ("A3", 6.0.into()),
                ("A4", 9.0.into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("B3", 3.0.into()),
                ("B4", 4.0.into()),
            ],
            "=LINEST(A1:A4,B1:B4,TRUE,TRUE)",
        );
        assert_eq!(shape(&v), (5, 2));
        let c = cells(&v);
        // Row 0: {m, b}; row 2: {R^2, SEy}.
        assert!((n(&c[0]) - 1.9).abs() < 1e-9);
        // R^2 = 0.961...: ssr/sst for this fit.
        assert!(n(&c[4]) > 0.95 && n(&c[4]) < 1.0);
    }

    fn n(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            o => panic!("expected number, got {o:?}"),
        }
    }

    #[test]
    fn stats_block_na_fill() {
        let v = eval("=LINEST({2;4;6;8},{1;2;3;4},TRUE,TRUE)");
        let c = cells(&v);
        // Unused cells of the 5x2 block are #N/A — none here since the
        // block is exactly 2 columns wide.
        assert_eq!(c.len(), 10);
        // Perfect fit: R^2 = 1, df_resid = 2.
        assert_eq!(n(&c[4]), 1.0);
        assert_eq!(n(&c[7]), 2.0);
    }

    #[test]
    fn row_vector_ys() {
        // ys as a row, xs rows as variables.
        let v = eval("=LINEST({2,4,6,8},{1,2,3,4})");
        assert_eq!(nums(&v), vec![2.0, 0.0]);
    }

    #[test]
    fn two_x_variables() {
        // y = 1*x1 + 2*x2, exact: x1=1..4, x2=1,2,1,2 -> y=3,6,5,8.
        let v = eval("=LINEST({3;6;5;8},{1,1;2,2;3,1;4,2})");
        // 1 row x 3 cols: {m2, m1, b} = {2, 1, 0}.
        assert_eq!(shape(&v), (1, 3));
        let c = nums(&v);
        assert!((c[0] - 2.0).abs() < 1e-12);
        assert!((c[1] - 1.0).abs() < 1e-12);
        assert!((c[2]).abs() < 1e-12);
    }

    #[test]
    fn mismatched_xs_ref_error() {
        assert_eq!(e(&eval("=LINEST({1;2;3},{1;2})")), CalcError::Ref);
    }

    #[test]
    fn text_cell_value_error() {
        let v = eval_with(&[("A1", 1.0.into()), ("A2", "x".into())], "=LINEST(A1:A2)");
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", Value::Error(CalcError::DivZero))],
            "=LINEST(A1:A2)",
        );
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn collinear_x_dropped() {
        // x2 = 2*x1: dropped column reports coefficient 0.
        let v = eval("=LINEST({5;10;15;20},{1,2;2,4;3,6;4,8})");
        // Column ys with xs 3x2: {m2, m1, b}; one of m1/m2 dropped -> 0.
        let c = nums(&v);
        assert!(c.contains(&0.0));
        assert_eq!(shape(&v), (1, 3));
    }

    #[test]
    fn const_false_forces_zero_intercept() {
        // y = 2x exactly through origin.
        assert_eq!(
            nums(&eval("=LINEST({2;4;6;8},{1;2;3;4},FALSE)")),
            vec![2.0, 0.0]
        );
    }

    #[test]
    fn const_arg_numeric_coerces() {
        // Numeric const coerces to boolean.
        assert_eq!(
            nums(&eval("=LINEST({2;4;6;8},{1;2;3;4},0)")),
            vec![2.0, 0.0]
        );
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=LINEST()")), CalcError::Value);
    }
}
