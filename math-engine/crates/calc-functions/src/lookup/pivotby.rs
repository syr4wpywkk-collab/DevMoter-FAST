//! `PIVOTBY(row_fields, col_fields, values, function,
//! [field_headers], [row_total_depth], [row_sort_order],
//! [col_total_depth], [col_sort_order], [filter_array],
//! [field_relationship])` — two-dimensional pivot aggregation. Spec:
//! `docs/functions/PIVOTBY.md`; shared semantics in
//! [`crate::common::groupby`].
//!
//! Layout choices where the spec is open (all noted there):
//! - One header row per `col_fields` column carrying that key level's
//!   values; the top-left block holds the `row_fields` names on its
//!   first row (`field_headers` = 3) or generated `"Field N"` names
//!   (`field_headers` = 2), blanks otherwise.
//! - Missing (row,col) intersections emit blank cells.
//! - `row_sort_order` indexes the result's columns
//!   (`1..=row_keys + col_groups*value_cols`); `col_sort_order`
//!   indexes the result's header/key axis — key column when
//!   `<= col_keys`, else body row index.
//! - `*_total_depth` `±1` emits a `"Grand Total"` row/column
//!   (positive: bottom/right, negative: top/left). `±2` adds
//!   row-axis subtotal rows per distinct first-key value (col-axis
//!   `±2` behaves as `±1` — hierarchical col subtotal layout is a
//!   documented gap).

use crate::common::{coercion, compare, groupby};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;
use std::cmp::Ordering;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 4, 11) {
        return Ok(Value::Error(e));
    }
    let rkeys_arr = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let ckeys_arr = match coercion::eval_array(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let vals = match coercion::eval_array(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let agg = match groupby::eval_agg(ctx, &args[3])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let headers = match groupby::opt_int(ctx, args.get(4), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(h) => h,
    };
    if !(0..=3).contains(&headers) {
        return Ok(Value::Error(CalcError::Value));
    }
    let rdepth = match groupby::opt_int(ctx, args.get(5), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };
    let rsort = match groupby::opt_int(ctx, args.get(6), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => s,
    };
    let cdepth = match groupby::opt_int(ctx, args.get(7), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };
    let csort = match groupby::opt_int(ctx, args.get(8), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => s,
    };
    let relationship = match groupby::opt_int(ctx, args.get(10), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(r) => r,
    };
    for d in [rdepth, cdepth] {
        if !(-2..=2).contains(&d) {
            return Ok(Value::Error(CalcError::Value));
        }
    }
    if !(0..=1).contains(&relationship) {
        return Ok(Value::Error(CalcError::Value));
    }
    if rkeys_arr.rows() != ckeys_arr.rows() || rkeys_arr.rows() != vals.rows() {
        return Ok(Value::Error(CalcError::Value));
    }

    let has_headers = headers == 1 || headers == 3;
    let first_data = if has_headers { 1 } else { 0 };
    let mask = match filter(ctx, args.get(9), rkeys_arr.rows())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(m) => m,
    };
    let kept: Vec<usize> = (first_data..rkeys_arr.rows() as usize)
        .filter(|&r| mask.get(r).copied().unwrap_or(false))
        .collect();
    let key_rows = |a: &ArrayValue| -> Vec<groupby::Key> {
        kept.iter()
            .map(|&r| {
                (0..a.cols())
                    .map(|c| a.get(r as u32, c).unwrap().clone())
                    .collect()
            })
            .collect()
    };
    let rkeys = key_rows(&rkeys_arr);
    let ckeys = key_rows(&ckeys_arr);
    let mut rgroups = groupby::group_rows(&rkeys);
    let mut cgroups = groupby::group_rows(&ckeys);

    let (nrk, nck, nv) = (
        rkeys_arr.cols() as usize,
        ckeys_arr.cols() as usize,
        vals.cols() as usize,
    );
    let all: Vec<Vec<Value>> = (0..nv)
        .map(|c| groupby::column_of(&vals, c as u32, &kept))
        .collect();

    // Body aggregates: body[gi][cj*nv + v] over rows in group gi AND
    // col-group cj. Missing intersections -> Blank.
    let mut body: Vec<Vec<Value>> = Vec::new();
    for rg in &rgroups {
        let mut row_vals: Vec<Value> = Vec::new();
        for cg in &cgroups {
            let intersection: Vec<usize> = rg.iter().copied().filter(|i| cg.contains(i)).collect();
            for col in &all {
                if intersection.is_empty() {
                    row_vals.push(Value::Blank);
                } else {
                    let gv: Vec<Value> = intersection.iter().map(|&i| col[i].clone()).collect();
                    row_vals.push(groupby::apply(ctx, &agg, &gv, col)?);
                }
            }
        }
        body.push(row_vals);
    }

    // Sort axes. `rsort` indexes result columns; `csort` indexes col
    // key cols, else a body row index (SPEC-OPEN).
    let result_cols = nrk + cgroups.len() * nv;
    if rsort != 0 && rsort.unsigned_abs() as usize > result_cols {
        return Ok(Value::Error(CalcError::Value));
    }
    if rsort != 0 {
        let idx = rsort.unsigned_abs() as usize - 1;
        let key_of = |gi: usize| -> Value {
            if idx < nrk {
                rkeys[rgroups[gi][0]][idx].clone()
            } else {
                body[gi][idx - nrk].clone()
            }
        };
        let mut order: Vec<usize> = (0..rgroups.len()).collect();
        order.sort_by(|&a, &b| {
            let o = compare::sort_cmp(&key_of(a), &key_of(b));
            if rsort < 0 { o.reverse() } else { o }
        });
        let mut new_groups = Vec::new();
        let mut new_body = Vec::new();
        for i in order {
            new_groups.push(rgroups[i].clone());
            new_body.push(body[i].clone());
        }
        rgroups = new_groups;
        body = new_body;
    }
    if csort != 0 {
        let idx = csort.unsigned_abs() as usize - 1;
        if idx >= nck + rgroups.len() {
            return Ok(Value::Error(CalcError::Value));
        }
        let key_of = |ci: usize| -> Value {
            if idx < nck {
                ckeys[cgroups[ci][0]][idx].clone()
            } else {
                let bi = idx - nck;
                body[bi].get(ci * nv).cloned().unwrap_or(Value::Blank)
            }
        };
        let mut order: Vec<usize> = (0..cgroups.len()).collect();
        order.sort_by(|&a, &b| {
            let o = compare::sort_cmp(&key_of(a), &key_of(b));
            if csort < 0 { o.reverse() } else { o }
        });
        cgroups = order.iter().map(|&i| cgroups[i].clone()).collect();
        // Recompute body columns under the new column order.
        body = Vec::new();
        for rg in &rgroups {
            let mut row_vals: Vec<Value> = Vec::new();
            for cg in &cgroups {
                let intersection: Vec<usize> =
                    rg.iter().copied().filter(|i| cg.contains(i)).collect();
                for col in &all {
                    if intersection.is_empty() {
                        row_vals.push(Value::Blank);
                    } else {
                        let gv: Vec<Value> = intersection.iter().map(|&i| col[i].clone()).collect();
                        row_vals.push(groupby::apply(ctx, &agg, &gv, col)?);
                    }
                }
            }
            body.push(row_vals);
        }
    }

    // ---------- assemble output grid ----------
    let total_col = cdepth != 0;
    let out_cols = nrk + cgroups.len() * nv + usize::from(total_col) * nv;
    let header_rows = nck.max(1);
    let mut grid: Vec<Vec<Value>> = Vec::new();

    // Header rows: one per col-key level.
    for level in 0..header_rows {
        let mut row = vec![Value::Blank; nrk];
        if level == 0 {
            for (c, cell) in row.iter_mut().enumerate().take(nrk) {
                *cell = Value::Text(if headers == 3 {
                    rkeys_arr
                        .get(0, c as u32)
                        .unwrap()
                        .to_text()
                        .unwrap_or_default()
                } else if headers == 2 {
                    format!("Field {}", c + 1)
                } else {
                    String::new()
                });
            }
        }
        for cg in &cgroups {
            let key_val = ckeys[cg[0]].get(level).cloned().unwrap_or(Value::Blank);
            for v in 0..nv {
                if v == 0 {
                    row.push(key_val.clone());
                } else {
                    row.push(Value::Blank);
                }
            }
        }
        if total_col && level == 0 {
            for _ in 0..nv {
                row.push(Value::Text(groupby::GRAND_TOTAL.into()));
            }
        } else if total_col {
            for _ in 0..nv {
                row.push(Value::Blank);
            }
        }
        grid.push(row);
    }

    // Helper for an aggregate over rows `idx` for value col `v`.
    let agg_over =
        |ctx: &mut EvalContext<'_>, idx: &[usize], v: usize| -> Result<Value, EvalError> {
            let gv: Vec<Value> = idx.iter().map(|&i| all[v][i].clone()).collect();
            groupby::apply(ctx, &agg, &gv, &all[v])
        };

    // (row label cells) -> body row with optional grand-total column.
    let emit = |ctx: &mut EvalContext<'_>,
                grid: &mut Vec<Vec<Value>>,
                label: Vec<Value>,
                body_vals: Vec<Value>,
                row_idx: Option<&[usize]>|
     -> Result<(), EvalError> {
        let mut row = label;
        while row.len() < nrk {
            row.push(Value::Blank);
        }
        row.extend(body_vals);
        if total_col {
            for v in 0..nv {
                let idx: Vec<usize> = match row_idx {
                    Some(i) => i.to_vec(),
                    None => (0..kept.len()).collect(),
                };
                row.push(agg_over(ctx, &idx, v)?);
            }
        }
        grid.push(row);
        Ok(())
    };

    // Row-axis subtotal groups (depth ±2, >=2 row key cols).
    let mut sub_rows: Vec<(Vec<Value>, Vec<usize>)> = Vec::new();
    if rdepth.unsigned_abs() == 2 && nrk >= 2 {
        let mut seen: Vec<Value> = Vec::new();
        for g in &rgroups {
            let k0 = rkeys[g[0]][0].clone();
            if seen
                .iter()
                .any(|v| compare::sort_cmp(v, &k0) == Ordering::Equal)
            {
                continue;
            }
            seen.push(k0.clone());
            let idx: Vec<usize> = (0..rkeys.len())
                .filter(|&i| compare::sort_cmp(&rkeys[i][0], &k0) == Ordering::Equal)
                .collect();
            sub_rows.push((vec![k0, Value::Text("Total".into())], idx));
        }
    }

    // Emit rows in display order (negative depth: totals first).
    let total_idx: Vec<usize> = (0..kept.len()).collect();
    let grand_row_vals = |ctx: &mut EvalContext<'_>| -> Result<Vec<Value>, EvalError> {
        let mut rv = Vec::new();
        for cg in &cgroups {
            for v in 0..nv {
                rv.push(agg_over(ctx, cg, v)?);
            }
        }
        Ok(rv)
    };
    let grand_label = vec![Value::Text(groupby::GRAND_TOTAL.into())];

    if rdepth < 0 {
        let gv = grand_row_vals(ctx)?;
        emit(ctx, &mut grid, grand_label.clone(), gv, Some(&total_idx))?;
        for (label, idx) in &sub_rows {
            let mut rv = Vec::new();
            for cg in &cgroups {
                let inter: Vec<usize> = idx.iter().copied().filter(|i| cg.contains(i)).collect();
                for v in 0..nv {
                    rv.push(agg_over(ctx, &inter, v)?);
                }
            }
            emit(ctx, &mut grid, label.clone(), rv, Some(idx))?;
        }
    }
    for (gi, g) in rgroups.iter().enumerate() {
        let label = rkeys[g[0]].clone();
        emit(ctx, &mut grid, label, body[gi].clone(), Some(g))?;
        // Positive-depth subtotal after each first-key block.
        if rdepth == 2 && nrk >= 2 {
            let k0 = &rkeys[g[0]][0];
            let last_of_block = rgroups
                .get(gi + 1)
                .map(|n| compare::sort_cmp(&rkeys[n[0]][0], k0) != Ordering::Equal)
                .unwrap_or(true);
            if last_of_block {
                if let Some((label, idx)) = sub_rows
                    .iter()
                    .find(|(l, _)| compare::sort_cmp(&l[0], k0) == Ordering::Equal)
                {
                    let mut rv = Vec::new();
                    for cg in &cgroups {
                        let inter: Vec<usize> =
                            idx.iter().copied().filter(|i| cg.contains(i)).collect();
                        for v in 0..nv {
                            rv.push(agg_over(ctx, &inter, v)?);
                        }
                    }
                    emit(ctx, &mut grid, label.clone(), rv, Some(idx))?;
                }
            }
        }
    }
    if rdepth > 0 {
        let gv = grand_row_vals(ctx)?;
        emit(ctx, &mut grid, grand_label, gv, Some(&total_idx))?;
    }

    let nrows = grid.len() as u32;
    let cells: Vec<Value> = grid.into_iter().flatten().collect();
    debug_assert_eq!(cells.len(), nrows as usize * out_cols);
    match ArrayValue::new(nrows, out_cols as u32, cells) {
        Ok(t) => Ok(Value::Array(t)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// `filter_array`: r×N boolean mask over all `row_fields` rows;
/// errors propagate. Identical rules to `GROUPBY`'s.
fn filter(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    rows: u32,
) -> Result<Result<Vec<bool>, CalcError>, EvalError> {
    let a = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(vec![true; rows as usize])),
        Some(e) => match coercion::eval_array(ctx, e)? {
            Err(e) => return Ok(Err(e)),
            Ok(a) => a,
        },
    };
    if a.rows() != rows {
        return Ok(Err(CalcError::Value));
    }
    let mut out = Vec::with_capacity(rows as usize);
    for r in 0..a.rows() {
        let mut keep = false;
        for c in 0..a.cols() {
            match a.get(r, c).unwrap().to_boolean() {
                Ok(b) => keep |= b,
                Err(e) => return Ok(Err(e)),
            }
        }
        out.push(keep);
    }
    Ok(Ok(out))
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn arr(v: &Value) -> (u32, u32, Vec<Value>) {
        match v {
            Value::Array(a) => (a.rows(), a.cols(), a.cells().to_vec()),
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
    fn basic_cross_tab() {
        // keys a/a/b/b x x/y/x/y, values 1,2,3,4.
        let (r, c, cells) = arr(&eval(
            r#"=PIVOTBY({"a";"a";"b";"b"},{"x";"y";"x";"y"},{1;2;3;4},"SUM")"#,
        ));
        // 1 header row + 2 rows; cols = 1 key + 2 col groups.
        assert_eq!((r, c), (3, 3));
        assert_eq!(cells[1], Value::Text("x".into()));
        assert_eq!(cells[2], Value::Text("y".into()));
        assert_eq!(cells[3], Value::Text("a".into()));
        assert_eq!(cells[4], Value::Number(1.0));
        assert_eq!(cells[5], Value::Number(2.0));
        assert_eq!(cells[7], Value::Number(3.0));
        assert_eq!(cells[8], Value::Number(4.0));
    }

    #[test]
    fn missing_intersection_is_blank() {
        let (_, _, cells) = arr(&eval(r#"=PIVOTBY({"a";"b"},{"x";"y"},{5;7},"SUM")"#));
        // a/y missing -> blank; b/x missing -> blank.
        assert!(cells[5].is_blank());
        assert!(cells[7].is_blank());
        assert_eq!(cells[4], Value::Number(5.0));
        assert_eq!(cells[8], Value::Number(7.0));
    }

    #[test]
    fn average_aggregation() {
        let (_, _, cells) = arr(&eval(r#"=PIVOTBY({"a";"a"},{"x";"x"},{1;2},"AVERAGE")"#));
        // 2x2 grid: [blank, "x"] header row, ["a", 1.5] data row.
        assert_eq!(cells[3], Value::Number(1.5));
    }

    #[test]
    fn filter_mask() {
        let (r, _, cells) = arr(&eval(
            r#"=PIVOTBY({"a";"b"},{"x";"x"},{1;2},"SUM",0,0,0,0,0,{FALSE;TRUE})"#,
        ));
        assert_eq!(r, 2);
        assert_eq!(cells[2], Value::Text("b".into()));
        assert_eq!(cells[3], Value::Number(2.0));
    }

    #[test]
    fn grand_total_row_and_col() {
        let (r, c, cells) = arr(&eval(
            r#"=PIVOTBY({"a";"b"},{"x";"y"},{1;2},"SUM",0,1,0,1)"#,
        ));
        // header + 2 rows + grand row; 1 key + 2 cols + grand col.
        assert_eq!((r, c), (4, 4));
        assert_eq!(cells[12], Value::Text("Grand Total".into()));
        assert_eq!(cells[15], Value::Number(3.0));
    }

    #[test]
    fn total_on_top_and_left() {
        let (r, _, cells) = arr(&eval(
            r#"=PIVOTBY({"a";"b"},{"x";"x"},{1;2},"SUM",0,-1,0,-1)"#,
        ));
        assert_eq!(r, 4);
        // Header row: blank, "x", "Grand Total".
        assert_eq!(cells[2], Value::Text("Grand Total".into()));
        // First data row is the grand total.
        assert_eq!(cells[3], Value::Text("Grand Total".into()));
    }

    #[test]
    fn row_sort_descending() {
        let (_, _, cells) = arr(&eval(r#"=PIVOTBY({"a";"b"},{"x";"x"},{1;2},"SUM",0,0,-1)"#));
        // -1 sorts by first result column (the row keys) descending.
        assert_eq!(cells[2], Value::Text("b".into()));
    }

    #[test]
    fn multi_col_groups() {
        // Two-column col_fields emit two header rows.
        let (r, c, cells) = arr(&eval(
            r#"=PIVOTBY({"a";"a"},{"x","p";"x","q"},{1;2},"SUM")"#,
        ));
        assert_eq!((r, c), (3, 3));
        // Level 0 header: "x", "x"; level 1: "p", "q".
        assert_eq!(cells[1], Value::Text("x".into()));
        assert_eq!(cells[2], Value::Text("x".into()));
        assert_eq!(cells[4], Value::Text("p".into()));
        assert_eq!(cells[5], Value::Text("q".into()));
    }

    #[test]
    fn lambda_aggregation() {
        let (_, _, cells) = arr(&eval(
            r#"=PIVOTBY({"a";"a"},{"x";"x"},{1;2},LAMBDA(x,MAX(x)))"#,
        ));
        assert_eq!(cells[3], Value::Number(2.0));
    }

    #[test]
    fn row_count_mismatch() {
        assert_eq!(
            e(&eval(r#"=PIVOTBY({"a";"b"},{"x"},{1;2},"SUM")"#)),
            CalcError::Value
        );
        assert_eq!(
            e(&eval(r#"=PIVOTBY({"a"},{"x"},{1;2},"SUM")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn enum_out_of_range() {
        assert_eq!(
            e(&eval(r#"=PIVOTBY({"a"},{"x"},{1},"SUM",4)"#)),
            CalcError::Value
        );
        assert_eq!(
            e(&eval(r#"=PIVOTBY({"a"},{"x"},{1},"SUM",0,3)"#)),
            CalcError::Value
        );
        assert_eq!(
            e(&eval(
                r#"=PIVOTBY({"a"},{"x"},{1},"SUM",0,0,0,0,0,{TRUE},2)"#
            )),
            CalcError::Value
        );
    }

    #[test]
    fn unknown_function_name() {
        assert_eq!(
            e(&eval(r#"=PIVOTBY({"a"},{"x"},{1},"NOPE")"#)),
            CalcError::Value
        );
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(
            e(&eval(r#"=PIVOTBY(1/0,{1},{1},"SUM")"#)),
            CalcError::DivZero
        );
        assert_eq!(
            e(&eval(r#"=PIVOTBY({"a"},{1},1/0,"SUM")"#)),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval(r#"=PIVOTBY({"a"},{"x"},{1})"#)), CalcError::Value);
        assert_eq!(
            e(&eval(r#"=PIVOTBY({"a"},{"x"},{1},"SUM",0,0,0,0,0,0,0,9)"#)),
            CalcError::Value
        );
    }
}
