//! Shared matrix helpers for `MDETERM`/`MINVERSE`/`MMULT` (row-major
//! `Vec<f64>`). Not a registered function.

use calc_core::array::ArrayValue;
use calc_core::error::CalcError;
use calc_core::value::Value;

/// Extract a dense `f64` matrix from an array argument.
/// `Value::Error` cells propagate; anything non-numeric (blank, text,
/// boolean) is `#VALUE!` per the MDETERM/MMULT "only numbers" rule.
pub fn to_f64_matrix(a: &ArrayValue) -> Result<(usize, usize, Vec<f64>), CalcError> {
    let (rows, cols) = (a.rows() as usize, a.cols() as usize);
    let mut m = Vec::with_capacity(a.len());
    for v in a.iter() {
        match v {
            Value::Number(n) => m.push(*n),
            Value::Error(e) => return Err(*e),
            _ => return Err(CalcError::Value),
        }
    }
    Ok((rows, cols, m))
}

/// Pivot magnitude below which a column is treated as zero, relative
/// to the largest input element. SPEC-OPEN (both MDETERM and MINVERSE
/// spec docs ask for a documented singularity threshold).
fn singularity_threshold(m: &[f64]) -> f64 {
    let max_abs = m.iter().fold(0.0_f64, |a, v| a.max(v.abs()));
    1e-12 * max_abs
}

/// Determinant via LU decomposition with partial pivoting.
/// `m` is row-major n x n. Returns `0.0` for singular matrices
/// (pivot below [`singularity_threshold`]).
pub fn determinant(n: usize, m: &[f64]) -> f64 {
    let mut a = m.to_vec();
    let tol = singularity_threshold(m);
    let mut det = 1.0;
    for col in 0..n {
        // Partial pivot: row >= col with largest |a[row,col]|.
        let mut pivot = col;
        for row in col + 1..n {
            if a[row * n + col].abs() > a[pivot * n + col].abs() {
                pivot = row;
            }
        }
        if a[pivot * n + col].abs() <= tol {
            return 0.0;
        }
        if pivot != col {
            for k in 0..n {
                a.swap(col * n + k, pivot * n + k);
            }
            det = -det;
        }
        let d = a[col * n + col];
        det *= d;
        for row in col + 1..n {
            let f = a[row * n + col] / d;
            if f == 0.0 {
                continue;
            }
            for k in col..n {
                a[row * n + k] -= f * a[col * n + k];
            }
        }
    }
    det
}

/// Inverse via Gauss-Jordan elimination with partial pivoting.
/// Returns `Err(CalcError::Num)` for singular matrices (pivot below
/// [`singularity_threshold`]).
pub fn inverse(n: usize, m: &[f64]) -> Result<Vec<f64>, CalcError> {
    let tol = singularity_threshold(m);
    let mut a = vec![0.0; n * n * 2];
    for r in 0..n {
        for c in 0..n {
            a[r * 2 * n + c] = m[r * n + c];
            a[r * 2 * n + n + c] = if r == c { 1.0 } else { 0.0 };
        }
    }
    for col in 0..n {
        let mut pivot = col;
        for row in col + 1..n {
            if a[row * 2 * n + col].abs() > a[pivot * 2 * n + col].abs() {
                pivot = row;
            }
        }
        if a[pivot * 2 * n + col].abs() <= tol {
            return Err(CalcError::Num);
        }
        if pivot != col {
            for k in 0..2 * n {
                a.swap(col * 2 * n + k, pivot * 2 * n + k);
            }
        }
        let d = a[col * 2 * n + col];
        for k in 0..2 * n {
            a[col * 2 * n + k] /= d;
        }
        for row in 0..n {
            if row == col {
                continue;
            }
            let f = a[row * 2 * n + col];
            if f == 0.0 {
                continue;
            }
            for k in 0..2 * n {
                a[row * 2 * n + k] -= f * a[col * 2 * n + k];
            }
        }
    }
    let mut inv = vec![0.0; n * n];
    for r in 0..n {
        for c in 0..n {
            inv[r * n + c] = a[r * 2 * n + n + c];
        }
    }
    Ok(inv)
}
