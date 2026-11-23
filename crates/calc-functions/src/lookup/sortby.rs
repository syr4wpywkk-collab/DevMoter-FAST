//! `SORTBY(array, by_array1, [sort_order1], [by_array2, sort_order2],
//! ...)` — sort `array` by one or more parallel key arrays, each with
//! its own direction. Spec: `docs/functions/SORTBY.md`.
//!
//! Direction is fixed by the first key: a column vector matching the
//! array's height sorts rows (Excel's documented precedence for the
//! ambiguous 1-column case); otherwise a row vector matching the width
//! sorts columns.

use crate::common::{coercion, compare};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;
use std::cmp::Ordering;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, usize::MAX) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };

    // Consume (key, [order]) pairs; an even trailing arg count is also
    // legal when every key carries an explicit order.
    let mut keys: Vec<(ArrayValue, bool)> = Vec::new(); // (key, descending)
    let mut i = 1usize;
    while i < args.len() {
        let key = match coercion::eval_array(ctx, &args[i])? {
            Err(e) => return Ok(Value::Error(e)),
            Ok(k) => k,
        };
        i += 1;
        let order = match args.get(i) {
            // A following numeric scalar `1`/`-1` is this key's order.
            Some(e) if !matches!(e, Expr::Missing) => {
                let v = ctx.eval(e)?;
                match v.to_number() {
                    Ok(n) if n.trunc() == 1.0 || n.trunc() == -1.0 => {
                        i += 1;
                        n.trunc() == -1.0
                    }
                    Ok(_) => return Ok(Value::Error(CalcError::Value)),
                    // Not a number: treat as the next key array.
                    Err(_) => false,
                }
            }
            _ => false,
        };
        keys.push((key, order));
    }

    // Fix the sort axis from the first key.
    let by_col = {
        let (first, _) = &keys[0];
        if first.cols() == 1 && first.rows() == a.rows() {
            false
        } else if first.rows() == 1 && first.cols() == a.cols() {
            true
        } else {
            return Ok(Value::Error(CalcError::Value));
        }
    };
    let items = if by_col { a.cols() } else { a.rows() };
    for (key, _) in &keys {
        let len = if by_col { key.cols() } else { key.rows() };
        if len != items {
            return Ok(Value::Error(CalcError::Value));
        }
    }

    let mut order: Vec<u32> = (0..items).collect();
    order.sort_by(|&x, &y| {
        for (key, desc) in &keys {
            let (l, r) = if by_col {
                (key.get(0, x).unwrap(), key.get(0, y).unwrap())
            } else {
                (key.get(x, 0).unwrap(), key.get(y, 0).unwrap())
            };
            let c = compare::sort_cmp(l, r);
            if c != Ordering::Equal {
                return if *desc { c.reverse() } else { c };
            }
        }
        Ordering::Equal
    });

    let mut cells = Vec::with_capacity((a.rows() * a.cols()) as usize);
    if by_col {
        for r in 0..a.rows() {
            for &c in &order {
                cells.push(a.get(r, c).unwrap().clone());
            }
        }
        ArrayValue::new(a.rows(), a.cols(), cells)
    } else {
        for &r in &order {
            for c in 0..a.cols() {
                cells.push(a.get(r, c).unwrap().clone());
            }
        }
        ArrayValue::new(a.rows(), a.cols(), cells)
    }
    .map(Value::Array)
    .or_else(|e| Ok(Value::Error(e)))
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

    fn nums(cells: &[Value]) -> Vec<f64> {
        cells
            .iter()
            .map(|v| match v {
                Value::Number(n) => *n,
                o => panic!("expected number, got {o:?}"),
            })
            .collect()
    }

    #[test]
    fn sorts_rows_by_key() {
        let (_, _, cells) = arr(&eval("=SORTBY({3,1;1,2;2,3},{3;1;2})"));
        assert_eq!(nums(&cells), vec![1.0, 2.0, 2.0, 3.0, 3.0, 1.0]);
    }

    #[test]
    fn text_keys_sort_case_insensitively() {
        let (_, _, cells) = arr(&eval(r#"=SORTBY({"b",1;"a",2},{"b";"a"})"#));
        assert_eq!(cells[0], Value::Text("a".into()));
    }

    #[test]
    fn descending_order() {
        // Descending by key {2;1} keeps the key-2 row ({1,5}) first —
        // SORTBY.md's worked example showing {2,6;1,5} contradicts its
        // own "-1 = descending" semantics (noted in the track PR).
        let (_, _, cells) = arr(&eval("=SORTBY({1,5;2,6},{2;1},-1)"));
        assert_eq!(nums(&cells), vec![1.0, 5.0, 2.0, 6.0]);
    }

    #[test]
    fn multiple_keys_break_ties() {
        // First key ascending, second key descending.
        let (_, _, cells) = arr(&eval("=SORTBY({1;2;3},{2;1;2},1,{9;8;7},-1)"));
        // keys: row1 (2,9), row2 (1,8), row3 (2,7) -> order 2,1,3
        assert_eq!(nums(&cells), vec![2.0, 1.0, 3.0]);
    }

    #[test]
    fn sorts_columns_by_row_key() {
        let (_, _, cells) = arr(&eval("=SORTBY({1,2;3,4},{2,1})"));
        assert_eq!(nums(&cells), vec![2.0, 1.0, 4.0, 3.0]);
    }

    #[test]
    fn key_length_mismatch() {
        assert_eq!(e(&eval("=SORTBY({1,2;3,4},{1;2;3})")), CalcError::Value);
        assert_eq!(e(&eval("=SORTBY({1,2;3,4},{1,2,3})")), CalcError::Value);
    }

    #[test]
    fn invalid_sort_order() {
        assert_eq!(e(&eval("=SORTBY({1;2},{2;1},0)")), CalcError::Value);
        assert_eq!(e(&eval("=SORTBY({1;2},{2;1},2)")), CalcError::Value);
    }

    #[test]
    fn two_dimensional_key_errors() {
        assert_eq!(e(&eval("=SORTBY({1,2;3,4},{1,2;3,4})")), CalcError::Value);
    }

    #[test]
    fn omitted_order_defaults_ascending() {
        let (_, _, cells) = arr(&eval("=SORTBY({2;1},{2;1})"));
        assert_eq!(nums(&cells), vec![1.0, 2.0]);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=SORTBY(1/0,{1})")), CalcError::DivZero);
        assert_eq!(e(&eval("=SORTBY({1},1/0)")), CalcError::DivZero);
    }

    #[test]
    fn blanks_sort_last_ascending() {
        // Blank key cell (B2 unset) sorts last ascending; the row
        // itself still carries its value (2), not a blank.
        let (_, _, cells) = arr(&eval_with(
            &[("B1", Value::Number(2.0)), ("B3", Value::Number(1.0))],
            "=SORTBY({1;2;3},B1:B3)",
        ));
        assert_eq!(nums(&cells), vec![3.0, 1.0, 2.0]);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=SORTBY({1})")), CalcError::Value);
    }
}
