//! `GROUPBY(row_fields, values, function, [field_headers],
//! [total_depth], [sort_order], [filter_array], [field_relationship])`
//! — group rows by `row_fields` keys and aggregate `values` per group.
//! Spec: `docs/functions/GROUPBY.md`. Shared aggregation semantics live
//! in [`crate::common::groupby`].
//!
//! Layout choices where the spec is open (all noted there):
//! - `sort_order` = `0`/omitted sorts groups by the key columns
//!   ascending; a nonzero index sorts by that *result* column
//!   (`1..=keys+values`), negative = descending.
//! - `total_depth` `±1` emits one `"Grand Total"` row (positive:
//!   bottom, negative: top). `±2` additionally emits a subtotal row
//!   per distinct value of the first key column when there are >=2 key
//!   columns, labeled with that value plus `"Total"`.
//! - `field_headers` `3` shows the input's first row as headers; `2`
//!   generates canonical `"Field N"` / `"<AGG> of Value N"` headers.
//! - `field_relationship` is validated (0/1) but currently inert —
//!   it only alters subtotal layout in Excel.

use crate::common::{coercion, compare, groupby};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;
use std::cmp::Ordering;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 8) {
        return Ok(Value::Error(e));
    }
    let keys_arr = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let vals = match coercion::eval_array(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let agg = match groupby::eval_agg(ctx, &args[2])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let headers = match groupby::opt_int(ctx, args.get(3), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(h) => h,
    };
    if !(0..=3).contains(&headers) {
        return Ok(Value::Error(CalcError::Value));
    }
    let total_depth = match groupby::opt_int(ctx, args.get(4), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(t) => t,
    };
    if !(-2..=2).contains(&total_depth) {
        return Ok(Value::Error(CalcError::Value));
    }
    let sort_order = match groupby::opt_int(ctx, args.get(5), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(s) => s,
    };
    let relationship = match groupby::opt_int(ctx, args.get(7), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(r) => r,
    };
    if !(0..=1).contains(&relationship) {
        return Ok(Value::Error(CalcError::Value));
    }
    if keys_arr.rows() != vals.rows() {
        return Ok(Value::Error(CalcError::Value));
    }

    // Optional header row (modes 1/3 consume row 0 as names).
    let has_headers = headers == 1 || headers == 3;
    let first_data = if has_headers { 1 } else { 0 };
    let mask = match filter(ctx, args.get(6), keys_arr.rows())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(m) => m,
    };
    let kept: Vec<usize> = (first_data..keys_arr.rows() as usize)
        .filter(|&r| mask.get(r).copied().unwrap_or(false))
        .collect();
    let keys: Vec<groupby::Key> = kept
        .iter()
        .map(|&r| {
            (0..keys_arr.cols())
                .map(|c| keys_arr.get(r as u32, c).unwrap().clone())
                .collect()
        })
        .collect();
    let groups = groupby::group_rows(&keys);

    // Aggregate each group across each value column.
    let all: Vec<Vec<Value>> = (0..vals.cols())
        .map(|c| groupby::column_of(&vals, c, &kept))
        .collect();
    let mut body: Vec<Vec<Value>> = Vec::new();
    for g in &groups {
        let mut row = keys[g[0]].clone();
        for col in &all {
            let gv: Vec<Value> = g.iter().map(|&i| col[i].clone()).collect();
            row.push(groupby::apply(ctx, &agg, &gv, col)?);
        }
        body.push(row);
    }

    // Sort group rows; totals are attached separately.
    let ncols = i64::from(keys_arr.cols() + vals.cols());
    if sort_order != 0 && sort_order.unsigned_abs() as i64 > ncols {
        return Ok(Value::Error(CalcError::Value));
    }
    body.sort_by(|a, b| {
        if sort_order == 0 {
            (0..keys_arr.cols() as usize)
                .map(|c| compare::sort_cmp(&a[c], &b[c]))
                .find(|o| *o != Ordering::Equal)
                .unwrap_or(Ordering::Equal)
        } else {
            let c = sort_order.unsigned_abs() as usize - 1;
            let o = compare::sort_cmp(&a[c], &b[c]);
            if sort_order < 0 { o.reverse() } else { o }
        }
    });

    // Total/subtotal rows.
    let mut grand: Option<Vec<Value>> = None;
    let mut subs: Vec<Vec<Value>> = Vec::new();
    if total_depth != 0 {
        let idx: Vec<usize> = (0..kept.len()).collect();
        let row = total_row(
            ctx,
            &agg,
            &all,
            &idx,
            keys_arr.cols(),
            vec![Value::Text(groupby::GRAND_TOTAL.into())],
        )?;
        grand = Some(row);
        if total_depth.unsigned_abs() == 2 && keys_arr.cols() >= 2 {
            let mut seen: Vec<Value> = Vec::new();
            for g in &groups {
                let k0 = keys[g[0]][0].clone();
                if seen
                    .iter()
                    .any(|v| compare::sort_cmp(v, &k0) == Ordering::Equal)
                {
                    continue;
                }
                seen.push(k0.clone());
                let idx: Vec<usize> = (0..keys.len())
                    .filter(|&i| compare::sort_cmp(&keys[i][0], &k0) == Ordering::Equal)
                    .collect();
                subs.push(total_row(
                    ctx,
                    &agg,
                    &all,
                    &idx,
                    keys_arr.cols(),
                    vec![k0, Value::Text("Total".into())],
                )?);
            }
        }
    }

    // Assemble: header, (negative) totals, body, (positive) totals.
    let mut rows_out: Vec<Vec<Value>> = Vec::new();
    if headers >= 2 {
        let mut hdr: Vec<Value> = Vec::new();
        for c in 0..keys_arr.cols() {
            let name = if headers == 3 {
                keys_arr.get(0, c).unwrap().to_text().unwrap_or_default()
            } else {
                format!("Field {}", c + 1)
            };
            hdr.push(Value::Text(name));
        }
        for c in 0..vals.cols() {
            let field = if headers == 3 {
                vals.get(0, c).unwrap().to_text().unwrap_or_default()
            } else {
                format!("Value {}", c + 1)
            };
            hdr.push(Value::Text(groupby::agg_title(&agg, &field)));
        }
        rows_out.push(hdr);
    }
    if total_depth < 0 {
        if let Some(g) = &grand {
            rows_out.push(g.clone());
        }
        rows_out.extend(subs.iter().cloned());
    }
    rows_out.extend(body);
    if total_depth > 0 {
        rows_out.extend(subs);
        if let Some(g) = grand {
            rows_out.push(g);
        }
    }

    let nrows = rows_out.len() as u32;
    let ncols_u = keys_arr.cols() + vals.cols();
    let cells: Vec<Value> = rows_out.into_iter().flatten().collect();
    match ArrayValue::new(nrows, ncols_u, cells) {
        Ok(t) => Ok(Value::Array(t)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// A grand-total or subtotal row: `label` fills the key columns
/// (padded with blanks), then one aggregate per value column.
fn total_row(
    ctx: &mut EvalContext<'_>,
    agg: &groupby::Agg,
    all: &[Vec<Value>],
    idx: &[usize],
    nkeys: u32,
    mut label: Vec<Value>,
) -> Result<Vec<Value>, EvalError> {
    while label.len() < nkeys as usize {
        label.push(Value::Blank);
    }
    for col in all {
        let gv: Vec<Value> = idx.iter().map(|&i| col[i].clone()).collect();
        label.push(groupby::apply(ctx, agg, &gv, col)?);
    }
    Ok(label)
}

/// `filter_array`: an r×N boolean mask over *all* rows of
/// `row_fields` (row 0 is masked separately when headers exist).
/// Members coerce per the standard boolean rules; errors propagate.
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
    fn basic_sum_grouping() {
        let (r, c, cells) = arr(&eval(r#"=GROUPBY({"a";"b";"a"},{1;2;3},"SUM")"#));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[0], Value::Text("a".into()));
        assert_eq!(cells[1], Value::Number(4.0));
        assert_eq!(cells[2], Value::Text("b".into()));
        assert_eq!(cells[3], Value::Number(2.0));
    }

    #[test]
    fn grand_total_row() {
        let (r, _, cells) = arr(&eval(r#"=GROUPBY({"a";"b";"a"},{1;2;3},"AVERAGE",0,1)"#));
        assert_eq!(r, 3);
        assert_eq!(cells[4], Value::Text("Grand Total".into()));
        assert_eq!(cells[5], Value::Number(2.0));
    }

    #[test]
    fn sort_by_result_column() {
        // sort_order -2: descending on result column 2 (the MAX).
        let (_, _, cells) = arr(&eval(r#"=GROUPBY({"x";"y"},{10;20},"MAX",0,0,-2)"#));
        assert_eq!(cells[0], Value::Text("y".into()));
        assert_eq!(cells[1], Value::Number(20.0));
    }

    #[test]
    fn filter_mask() {
        let (r, _, cells) = arr(&eval(
            r#"=GROUPBY({"a";"b"},{1;2},"SUM",0,0,0,{TRUE;FALSE})"#,
        ));
        assert_eq!(r, 1);
        assert_eq!(cells[1], Value::Number(1.0));
    }

    #[test]
    fn multi_value_columns() {
        let (r, c, cells) = arr(&eval(r#"=GROUPBY({"a";"a"},{1,10;2,20},"SUM")"#));
        assert_eq!((r, c), (1, 3));
        assert_eq!(cells[1], Value::Number(3.0));
        assert_eq!(cells[2], Value::Number(30.0));
    }

    #[test]
    fn multi_key_columns() {
        let (r, c, cells) = arr(&eval(
            r#"=GROUPBY({"a","x";"a","y";"b","x"},{1;2;3},"SUM")"#,
        ));
        assert_eq!((r, c), (3, 3));
        assert_eq!(cells[2], Value::Number(1.0));
        assert_eq!(cells[5], Value::Number(2.0));
        assert_eq!(cells[8], Value::Number(3.0));
    }

    #[test]
    fn lambda_aggregation() {
        let (r, _, cells) = arr(&eval(
            r#"=GROUPBY({"a";"b";"a"},{1;2;3},LAMBDA(x,SUM(x)*10))"#,
        ));
        assert_eq!(r, 2);
        assert_eq!(cells[1], Value::Number(40.0));
    }

    #[test]
    fn header_mode_3() {
        let (r, _, cells) = arr(&eval(r#"=GROUPBY({"k";"a";"b"},{"v";1;2},"SUM",3)"#));
        assert_eq!(r, 3);
        assert_eq!(cells[0], Value::Text("k".into()));
        assert_eq!(cells[1], Value::Text("SUM of v".into()));
        assert_eq!(cells[2], Value::Text("a".into()));
    }

    #[test]
    fn row_count_mismatch() {
        assert_eq!(
            e(&eval(r#"=GROUPBY({"a";"b"},{1;2;3},"SUM")"#)),
            CalcError::Value
        );
        assert_eq!(
            e(&eval(r#"=GROUPBY({"a";"b"},{1;2},"SUM",0,0,0,{TRUE})"#)),
            CalcError::Value
        );
    }

    #[test]
    fn unknown_function_name() {
        assert_eq!(e(&eval(r#"=GROUPBY({"a"},{1},"NOPE")"#)), CalcError::Value);
    }

    #[test]
    fn enum_out_of_range() {
        assert_eq!(e(&eval(r#"=GROUPBY({"a"},{1},"SUM",4)"#)), CalcError::Value);
        assert_eq!(
            e(&eval(r#"=GROUPBY({"a"},{1},"SUM",0,3)"#)),
            CalcError::Value
        );
        assert_eq!(
            e(&eval(r#"=GROUPBY({"a"},{1},"SUM",0,0,0,{TRUE},2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn percentof_shares() {
        let (_, _, cells) = arr(&eval(r#"=GROUPBY({"a";"b";"a"},{1;2;3},"PERCENTOF")"#));
        match &cells[1] {
            Value::Number(n) => assert!((n - 4.0 / 6.0).abs() < 1e-12),
            o => panic!("expected number, got {o:?}"),
        }
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval(r#"=GROUPBY(1/0,{1},"SUM")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=GROUPBY({"a"},1/0,"SUM")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=GROUPBY({"a"},{1},1/0)"#)), CalcError::DivZero);
        let (_, _, cells) = arr(&eval(r#"=GROUPBY({"a";"b"},{#DIV/0!;2},"SUM")"#));
        assert_eq!(cells[1], Value::Error(CalcError::DivZero));
        assert_eq!(cells[3], Value::Number(2.0));
    }

    #[test]
    fn total_on_top() {
        let (r, _, cells) = arr(&eval(r#"=GROUPBY({"a";"b"},{1;2},"SUM",0,-1)"#));
        assert_eq!(r, 3);
        assert_eq!(cells[0], Value::Text("Grand Total".into()));
        assert_eq!(cells[1], Value::Number(3.0));
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval(r#"=GROUPBY({"a"},{1})"#)), CalcError::Value);
        assert_eq!(
            e(&eval(r#"=GROUPBY({"a"},{1},"SUM",0,0,0,{TRUE},0,9)"#)),
            CalcError::Value
        );
    }
}
