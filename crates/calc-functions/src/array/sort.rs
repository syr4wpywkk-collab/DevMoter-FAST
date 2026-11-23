//! `SORT(array, [sort_index], [sort_order], [by_col])` — sorted copy of
//! an array. Stable: equal keys keep original order (v2 §6, original
//! index as tiebreaker). Spec: `docs/functions/SORT.md`.

use crate::common::{coercion, compare};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 4) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let by_col = match flag_arg(ctx, args.get(3))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    // Items sorted are rows (default) or columns (by_col).
    let (items, item_len) = if by_col {
        (a.cols(), a.rows())
    } else {
        (a.rows(), a.cols())
    };
    let sort_index = match int_arg(ctx, args.get(1), 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(i) => i,
    };
    if sort_index < 1 || sort_index as u64 > u64::from(item_len) {
        return Ok(Value::Error(CalcError::Value));
    }
    let sort_order = match int_arg(ctx, args.get(2), 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(o) => o,
    };
    if sort_order != 1 && sort_order != -1 {
        return Ok(Value::Error(CalcError::Value));
    }
    let descending = sort_order == -1;
    let key = sort_index as u32 - 1;

    // `Vec::sort_by` is stable, so equal keys keep their original
    // relative order — the v2 §6 "original index as tiebreaker" rule.
    let mut order: Vec<u32> = (0..items).collect();
    order.sort_by(|&i, &j| {
        let (l, r) = if by_col {
            (
                a.get(key, i).expect("key row"),
                a.get(key, j).expect("key row"),
            )
        } else {
            (
                a.get(i, key).expect("key col"),
                a.get(j, key).expect("key col"),
            )
        };
        compare::sort_cmp_dir(l, r, descending)
    });

    let (rows, cols) = if by_col {
        (a.rows(), items)
    } else {
        (items, a.cols())
    };
    let mut cells = Vec::with_capacity(a.len());
    for r in 0..rows {
        for c in 0..cols {
            // Emit item `order[c]` (by_col) or `order[r]` (by_row).
            let v = if by_col {
                a.get(r, order[c as usize]).expect("in bounds")
            } else {
                a.get(order[r as usize], c).expect("in bounds")
            };
            cells.push(v.clone());
        }
    }
    match ArrayValue::new(rows, cols, cells) {
        Ok(s) => Ok(Value::Array(s)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Optional integer argument (truncated); `Missing`/blank -> `default`.
fn int_arg(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    default: i64,
) -> Result<Result<i64, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(default)),
        Some(e) => ctx.eval(e)?,
    };
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    if v.is_blank() {
        return Ok(Ok(default));
    }
    Ok(v.to_number().map(|n| {
        if n.is_finite() {
            n.trunc() as i64
        } else {
            i64::MAX // fails the range check downstream
        }
    }))
}

/// Optional boolean flag; `Missing`/blank -> FALSE.
fn flag_arg(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
) -> Result<Result<bool, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(false)),
        Some(e) => ctx.eval(e)?,
    };
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    if v.is_blank() {
        return Ok(Ok(false));
    }
    Ok(v.to_boolean())
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
    fn sorts_first_column_ascending() {
        let (r, c, cells) = arr(&eval("=SORT({3,30;1,10;2,20})"));
        assert_eq!((r, c), (3, 2));
        assert_eq!(cells[0], Value::Number(1.0));
        assert_eq!(cells[4], Value::Number(3.0));
    }

    #[test]
    fn descending() {
        let (_, _, cells) = arr(&eval("=SORT({1;3;2},1,-1)"));
        assert_eq!(
            cells,
            vec![Value::Number(3.0), Value::Number(2.0), Value::Number(1.0)]
        );
    }

    #[test]
    fn sort_by_second_column() {
        let (_, _, cells) = arr(&eval("=SORT({1,30;2,10;3,20},2)"));
        assert_eq!(cells[0], Value::Number(2.0)); // key 10 first
    }

    #[test]
    fn stable_on_equal_keys() {
        // Rows 1 and 3 share key 9; their payload order must be kept.
        // Sorted layout: r0: 5,"b" ; r1: 9,"a" ; r2: 9,"c".
        let (_, _, cells) = arr(&eval("=SORT({9,\"a\";5,\"b\";9,\"c\"})"));
        assert_eq!(cells[3], Value::Text("a".to_string()));
        assert_eq!(cells[5], Value::Text("c".to_string()));
    }

    #[test]
    fn type_hierarchy() {
        // number < text < boolean < error, blanks last.
        let (_, _, cells) = arr(&eval(r#"=SORT({TRUE;"a";5;#N/A;""})"#));
        // "" is Text, not blank: sorts inside text.
        assert_eq!(cells[0], Value::Number(5.0));
        assert_eq!(cells[3], Value::Boolean(true));
        assert_eq!(cells[4], Value::Error(CalcError::NA));
    }

    #[test]
    fn blanks_last_both_directions() {
        let (_, _, asc) = arr(&eval("=SORT(A1:A3)"));
        let (_, _, desc) = arr(&eval("=SORT(A1:A3,1,-1)"));
        // A1:A3 all blank: order irrelevant, blanks fill everything.
        assert!(asc.iter().all(|v| v.is_blank()));
        assert!(desc.iter().all(|v| v.is_blank()));
        let v = eval_with(
            &[("A1", 2.0.into()), ("A3", 1.0.into())],
            "=SORT(A1:A3,1,-1)",
        );
        let (_, _, cells) = arr(&v);
        assert_eq!(cells[2], Value::Blank);
    }

    #[test]
    fn text_case_insensitive() {
        let (_, _, cells) = arr(&eval(r#"=SORT({"b";"A";"c"})"#));
        assert_eq!(cells[0], Value::Text("A".to_string()));
    }

    #[test]
    fn by_col() {
        let (r, c, cells) = arr(&eval("=SORT({3,1,2},1,1,TRUE)"));
        assert_eq!((r, c), (1, 3));
        assert_eq!(
            cells,
            vec![Value::Number(1.0), Value::Number(2.0), Value::Number(3.0)]
        );
    }

    #[test]
    fn sort_index_out_of_range() {
        assert_eq!(e(&eval("=SORT({1,2},0)")), CalcError::Value);
        assert_eq!(e(&eval("=SORT({1,2},3)")), CalcError::Value);
    }

    #[test]
    fn bad_sort_order() {
        assert_eq!(e(&eval("=SORT({1,2},1,0)")), CalcError::Value);
        assert_eq!(e(&eval("=SORT({1,2},1,2)")), CalcError::Value);
    }

    #[test]
    fn non_numeric_index() {
        assert_eq!(e(&eval(r#"=SORT({1,2},"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=SORT(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=SORT()")), CalcError::Value);
        assert_eq!(e(&eval("=SORT({1},1,1,FALSE,1)")), CalcError::Value);
    }

    #[test]
    fn errors_sort_to_end() {
        let (_, _, cells) = arr(&eval("=SORT({#N/A;2;#DIV/0!;1})"));
        assert_eq!(cells[0], Value::Number(1.0));
        assert_eq!(cells[1], Value::Number(2.0));
        assert!(cells[2].is_error() && cells[3].is_error());
    }
}
