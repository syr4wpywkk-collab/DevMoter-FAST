//! Database-function (`D*`) shared semantics: the single owner of the
//! `(database, field, criteria)` argument model documented in
//! `docs/functions/DSUM.md` (shared by every `D*` spec).
//!
//! - `database` is a rectangular matrix whose first row is the header
//!   row; `field` resolves to one column either by 1-based index or by
//!   case-insensitive header-label match.
//! - `criteria` is a matrix whose first row holds labels matching
//!   `database` headers; each subsequent row is an alternative (OR),
//!   and multiple cells inside one criteria row are conjunctive (AND).
//!   A blank criteria cell imposes no constraint. Individual criteria
//!   cells reuse [`crate::common::criteria::Criterion`], so comparison
//!   prefixes, wildcards and blank matching behave like `SUMIF` et al.
//!
//! Deliberate choices where the spec docs mark the question SPEC-OPEN:
//! - Field-label and criteria-header matching is case-insensitive and
//!   does not trim whitespace (matching Excel's comparison rules for
//!   text equality).
//! - Bare text criteria (no comparison prefix, non-numeric) are matched
//!   as *prefixes* (`"App"` matches `"Apple"`), the documented Excel
//!   `D*` quirk. This is implemented by appending a `*` wildcard before
//!   parsing. Criteria carrying an explicit comparison prefix or a
//!   numeric/boolean operand keep `SUMIF`-style semantics.
//! - A blank criteria header whose column contains a non-blank
//!   criterion is an unmatched header -> `#VALUE!`; a criteria column
//!   that is entirely blank (header included) is ignored.
//! - Computed/formula criteria (`=` followed by a formula to evaluate
//!   per data row) are not supported: such cells are parsed as literal
//!   `=`-prefix text criteria. This is an engine capability gap noted
//!   in the spec docs.
//! - Error cells in the `field` column of *matching* rows propagate
//!   (first error wins); errors in non-matching rows are ignored.
//!   Error cells in the criteria range propagate when parsed.

use crate::common::criteria::{self, Criterion};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::value::{Value, parse_number_text};

/// Resolved view of a `D*(database, field, criteria)` call.
pub struct Selection {
    /// The database matrix (row 0 = headers).
    pub db: ArrayValue,
    /// Resolved field column (0-based).
    pub col: usize,
    /// Matching data-row indices (0-based; database row = index + 1).
    pub rows: Vec<usize>,
}

impl Selection {
    /// Field cell for a matched row index (`idx` indexes `rows`).
    pub fn field_cell(&self, idx: usize) -> &Value {
        // `rows` only contains valid indices and `col` is in range.
        self.db
            .get(self.rows[idx] as u32 + 1, self.col as u32)
            .unwrap_or(&Value::Blank)
    }

    /// Iterate over the field cells of all matching rows.
    pub fn field_cells(&self) -> impl Iterator<Item = &Value> {
        (0..self.rows.len()).map(|i| self.field_cell(i))
    }

    /// First error value among the field cells of matching rows, if any.
    pub fn field_error(&self) -> Option<CalcError> {
        self.field_cells().find_map(|v| v.error())
    }

    /// Numeric field values over matching rows (non-numeric skipped).
    pub fn field_numbers(&self) -> Vec<f64> {
        self.field_cells()
            .filter_map(|v| match v {
                Value::Number(n) => Some(*n),
                _ => None,
            })
            .collect()
    }
}

/// Evaluate `args` as `(database, field, criteria)` for a `D*` function.
/// `Ok(Err(e))` is a user-visible `Value::Error(e)`.
pub fn select(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Result<Result<Selection, CalcError>, EvalError> {
    let db = match criteria::eval_cells(ctx, &args[0])? {
        Err(e) => return Ok(Err(e)),
        Ok(a) => a,
    };
    let headers = header_labels(&db);

    let col = match resolve_field(ctx, &args[1], &headers, db.cols())? {
        Err(e) => return Ok(Err(e)),
        Ok(c) => c,
    };

    let crit = match criteria::eval_cells(ctx, &args[2])? {
        Err(e) => return Ok(Err(e)),
        Ok(a) => a,
    };
    let rows = match matching_rows(&db, &headers, &crit) {
        Err(e) => return Ok(Err(e)),
        Ok(r) => r,
    };

    Ok(Ok(Selection { db, col, rows }))
}

/// Header labels of each database column. Only scalar cells label a
/// column; numbers/booleans are rendered, blanks/errors carry no label.
fn header_labels(db: &ArrayValue) -> Vec<Option<String>> {
    (0..db.cols())
        .map(|c| value_label(db.get(0, c).unwrap_or(&Value::Blank)))
        .collect()
}

/// Render a scalar cell value as a matchable label.
fn value_label(v: &Value) -> Option<String> {
    match v {
        Value::Text(s) => Some(s.clone()),
        Value::Number(n) => Some(if n.fract() == 0.0 && n.abs() < 1e15 {
            format!("{}", *n as i64)
        } else {
            format!("{n}")
        }),
        Value::Boolean(b) => Some(if *b { "TRUE" } else { "FALSE" }.to_string()),
        _ => None,
    }
}

/// Find the database column whose header label equals `label`
/// (case-insensitive). First match wins.
fn find_column(headers: &[Option<String>], label: &str) -> Option<usize> {
    headers
        .iter()
        .position(|h| h.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(label)))
}

/// Resolve the `field` argument to a 0-based column index.
fn resolve_field(
    ctx: &mut EvalContext<'_>,
    expr: &Expr,
    headers: &[Option<String>],
    ncols: u32,
) -> Result<Result<usize, CalcError>, EvalError> {
    let v = match ctx.eval_arg(expr)? {
        ArgValue::Scalar(v) | ArgValue::Ref(v) => v,
        // A multi-cell range/array as field is invalid.
        ArgValue::Range(_) => return Ok(Err(CalcError::Value)),
    };
    let col = match &v {
        Value::Error(e) => return Ok(Err(*e)),
        Value::Number(n) => {
            if n.fract() == 0.0 && *n >= 1.0 && *n <= f64::from(ncols) {
                *n as usize - 1
            } else {
                return Ok(Err(CalcError::Value));
            }
        }
        Value::Text(s) => match find_column(headers, s) {
            Some(c) => c,
            None => return Ok(Err(CalcError::Value)),
        },
        _ => return Ok(Err(CalcError::Value)),
    };
    Ok(Ok(col))
}

/// One conjunctive term: a database column plus its criterion.
struct Term {
    db_col: usize,
    crit: Criterion,
}

/// Compute the matching data-row indices (0-based data rows).
fn matching_rows(
    db: &ArrayValue,
    headers: &[Option<String>],
    crit: &ArrayValue,
) -> Result<Vec<usize>, CalcError> {
    // Map each criteria column to a database column. A blank header is
    // allowed only when every criteria cell below it is blank.
    let mut col_map: Vec<Option<usize>> = Vec::with_capacity(crit.cols() as usize);
    for c in 0..crit.cols() {
        let head = crit.get(0, c).unwrap_or(&Value::Blank);
        match value_label(head) {
            Some(label) => match find_column(headers, &label) {
                Some(dc) => col_map.push(Some(dc)),
                None => return Err(CalcError::Value),
            },
            None => {
                if head.is_error() {
                    return Err(head.error().unwrap());
                }
                let all_blank =
                    (1..crit.rows()).all(|r| crit.get(r, c).unwrap_or(&Value::Blank).is_blank());
                if all_blank {
                    col_map.push(None);
                } else {
                    return Err(CalcError::Value);
                }
            }
        }
    }

    // Parse each criteria row into a conjunction of terms.
    let mut alternatives: Vec<Vec<Term>> = Vec::new();
    for r in 1..crit.rows() {
        let mut terms = Vec::new();
        for (c, db_col) in col_map.iter().enumerate() {
            let Some(dc) = db_col else { continue };
            let cell = crit.get(r, c as u32).unwrap_or(&Value::Blank);
            if cell.is_blank() {
                continue; // blank criteria cell: no constraint
            }
            let cell = excel_prefix_quirk(cell);
            terms.push(Term {
                db_col: *dc,
                crit: Criterion::from_value(&cell)?,
            });
        }
        alternatives.push(terms);
    }
    // A criteria range with no criteria rows matches every data row.
    if alternatives.is_empty() {
        alternatives.push(Vec::new());
    }

    let n_data = db.rows().saturating_sub(1) as usize;
    let mut rows = Vec::new();
    for i in 0..n_data {
        let r = i as u32 + 1;
        let hit = alternatives.iter().any(|terms| {
            terms.iter().all(|t| {
                let cell = db.get(r, t.db_col as u32).unwrap_or(&Value::Blank);
                t.crit.matches(cell)
            })
        });
        if hit {
            rows.push(i);
        }
    }
    Ok(rows)
}

/// Excel `D*` quirk: a bare text criterion (no leading comparison
/// operator, not numeric/`TRUE`/`FALSE`) matches text *prefixes*
/// (`"App"` matches `"Apple"`). Expressed by appending `*` so the
/// shared wildcard matcher performs the prefix match. Explicit
/// comparison prefixes and numeric/boolean operands are unchanged.
fn excel_prefix_quirk(cell: &Value) -> Value {
    let Value::Text(s) = cell else {
        return cell.clone();
    };
    let has_op = s.starts_with('=') || s.starts_with('<') || s.starts_with('>');
    let is_scalar = parse_number_text(s).is_some()
        || s.trim().eq_ignore_ascii_case("TRUE")
        || s.trim().eq_ignore_ascii_case("FALSE");
    if has_op || is_scalar || s.is_empty() {
        cell.clone()
    } else {
        Value::Text(format!("{s}*"))
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use calc_core::error::CalcError;
    use calc_core::value::Value;

    /// The layout shared by every `D*` spec doc: `A1:C5` holds headers
    /// `Tree, Height, Age` with rows `Apple,18,20` / `Pear,12,12` /
    /// `Cherry,13,14` / `Apple,10,15`; `E1:E2` = `Tree`/`Apple`,
    /// `F1:F2` = `Height`/`18`, `G1:G2` = `Tree`/`Fig`.
    pub fn db() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", "Tree".into()),
            ("B1", "Height".into()),
            ("C1", "Age".into()),
            ("A2", "Apple".into()),
            ("B2", 18.0.into()),
            ("C2", 20.0.into()),
            ("A3", "Pear".into()),
            ("B3", 12.0.into()),
            ("C3", 12.0.into()),
            ("A4", "Cherry".into()),
            ("B4", 13.0.into()),
            ("C4", 14.0.into()),
            ("A5", "Apple".into()),
            ("B5", 10.0.into()),
            ("C5", 15.0.into()),
            ("E1", "Tree".into()),
            ("E2", "Apple".into()),
            ("F1", "Height".into()),
            ("F2", 18.0.into()),
            ("G1", "Tree".into()),
            ("G2", "Fig".into()),
        ]
    }

    pub fn n(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            o => panic!("expected number, got {o:?}"),
        }
    }

    pub fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }
}
