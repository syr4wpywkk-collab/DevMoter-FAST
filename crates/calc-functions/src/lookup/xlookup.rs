//! `XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found],
//! [match_mode], [search_mode])` — search one vector and return the
//! corresponding element (or slice) of another.
//! Spec: `docs/functions/XLOOKUP.md`.
//!
//! `if_not_found` is evaluated lazily — only on a miss. `search_mode`
//! ±2 assumes sorted input (binary search, same caveat as `MATCH` ±1).
//! A `return_array` wider/deeper than the search dimension returns an
//! array slice (the engine represents arrays directly).

use crate::common::lookup;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Search orientation: `Col` searches down rows, `Row` across columns.
#[derive(Clone, Copy, PartialEq)]
enum Dir {
    Col,
    Row,
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 6) {
        return Ok(Value::Error(e));
    }
    let needle = ctx.eval(&args[0])?;
    if let Some(e) = needle.error() {
        return Ok(Value::Error(e));
    }

    let (keys, dir) = match vector(ctx, &args[1])? {
        Ok(v) => v,
        Err(v) => return Ok(v),
    };
    let returns = match ctx.eval_arg(&args[2])? {
        ArgValue::Range(a) | ArgValue::Scalar(Value::Array(a)) => a,
        ArgValue::Scalar(Value::Error(e)) | ArgValue::Ref(Value::Error(e)) => {
            return Ok(Value::Error(e));
        }
        ArgValue::Ref(v) | ArgValue::Scalar(v) => ArrayValue::new(1, 1, vec![v]).expect("1x1"),
    };
    // Length along the search dimension must match.
    let len_ok = match dir {
        Dir::Col => returns.rows() as usize == keys.len(),
        Dir::Row => returns.cols() as usize == keys.len(),
    };
    if !len_ok {
        return Ok(Value::Error(CalcError::Value));
    }

    let int_arg = |ctx: &mut EvalContext<'_>, i: usize, default: i64| match args.get(i) {
        None | Some(Expr::Missing) => Ok(Ok(default)),
        Some(expr) => {
            let v = ctx.eval(expr)?;
            Ok(if v.is_blank() {
                Ok(default)
            } else {
                lookup::index_to_i64(&v)
            })
        }
    };
    let match_mode = match int_arg(ctx, 4, 0)? {
        Ok(m @ -1..=2) => m,
        _ => return Ok(Value::Error(CalcError::Value)),
    };
    let search_mode = match int_arg(ctx, 5, 1)? {
        Ok(s @ (1 | -1 | 2 | -2)) => s,
        _ => return Ok(Value::Error(CalcError::Value)),
    };

    let pos = find(&keys, &needle, match_mode, search_mode);
    let Some(i) = pos else {
        // if_not_found is lazy: evaluated only when the search misses.
        return match args.get(3) {
            None | Some(Expr::Missing) => Ok(lookup::not_found()),
            Some(expr) => ctx.eval(expr),
        };
    };
    Ok(result_at(&returns, dir, i))
}

/// Extract a 1-D key vector from `lookup_array`; 2-D input is `#VALUE!`.
fn vector(
    ctx: &mut EvalContext<'_>,
    expr: &Expr,
) -> Result<Result<(Vec<Value>, Dir), Value>, EvalError> {
    let a = match ctx.eval_arg(expr)? {
        ArgValue::Range(a) | ArgValue::Scalar(Value::Array(a)) => a,
        ArgValue::Scalar(Value::Error(e)) | ArgValue::Ref(Value::Error(e)) => {
            return Ok(Err(Value::Error(e)));
        }
        ArgValue::Ref(v) | ArgValue::Scalar(v) => return Ok(Ok((vec![v], Dir::Col))),
    };
    let dir = if a.cols() == 1 {
        Dir::Col
    } else if a.rows() == 1 {
        Dir::Row
    } else {
        return Ok(Err(Value::Error(CalcError::Value)));
    };
    Ok(Ok((a.into_iter().collect(), dir)))
}

fn find(keys: &[Value], needle: &Value, match_mode: i64, search_mode: i64) -> Option<usize> {
    let exactish = |i: usize| lookup::exact_cell_match(needle, &keys[i], match_mode == 2);
    match (match_mode, search_mode) {
        // Binary-search modes assume sorted input (same caveat as MATCH).
        (-1, 2) => lookup::approx_asc(keys, needle),
        (1, 2) => lookup::approx_asc_ge(keys, needle),
        (-1, -2) => lookup::approx_desc_le(keys, needle),
        (1, -2) => lookup::approx_desc(keys, needle),
        (_, 2) => lookup::approx_asc(keys, needle).filter(|&i| exactish(i)),
        (_, -2) => lookup::approx_desc(keys, needle).filter(|&i| exactish(i)),
        (0, rev) => lookup::exact_position(keys, needle, false, rev == -1),
        (2, rev) => lookup::exact_position(keys, needle, true, rev == -1),
        // Approximate modes: exact hit first (in search direction), else
        // nearest smaller/larger element.
        (m, rev) => lookup::exact_position(keys, needle, false, rev == -1)
            .or_else(|| lookup::nearest(keys, needle, m == -1)),
    }
}

/// Pull the matched index out of `return_array` along `dir`: a scalar
/// when the perpendicular extent is 1, else a slice array.
fn result_at(returns: &ArrayValue, dir: Dir, i: usize) -> Value {
    match dir {
        Dir::Col => {
            if returns.cols() == 1 {
                returns.get(i as u32, 0).unwrap().clone()
            } else {
                let row: Vec<Value> = (0..returns.cols())
                    .map(|c| returns.get(i as u32, c).unwrap().clone())
                    .collect();
                Value::Array(ArrayValue::from_row(row).expect("row slice"))
            }
        }
        Dir::Row => {
            if returns.rows() == 1 {
                returns.get(0, i as u32).unwrap().clone()
            } else {
                let col: Vec<Value> = (0..returns.rows())
                    .map(|r| returns.get(r, i as u32).unwrap().clone())
                    .collect();
                Value::Array(ArrayValue::from_column(col).expect("col slice"))
            }
        }
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

    fn table() -> Vec<(&'static str, Value)> {
        vec![
            ("A1", "a".into()),
            ("A2", "b".into()),
            ("A3", "c".into()),
            ("B1", 10.0.into()),
            ("B2", 20.0.into()),
            ("B3", 30.0.into()),
        ]
    }

    #[test]
    fn basic_exact() {
        assert_eq!(
            n(&eval_with(&table(), r#"=XLOOKUP("b",A1:A3,B1:B3)"#)),
            20.0
        );
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(
            n(&eval_with(&table(), r#"=XLOOKUP("B",A1:A3,B1:B3)"#)),
            20.0
        );
    }

    #[test]
    fn not_found_default_na() {
        assert_eq!(
            e(&eval_with(&table(), r#"=XLOOKUP("z",A1:A3,B1:B3)"#)),
            CalcError::NA
        );
    }

    #[test]
    fn if_not_found() {
        let v = eval_with(&table(), r#"=XLOOKUP("z",A1:A3,B1:B3,"missing")"#);
        assert_eq!(v, Value::Text("missing".into()));
    }

    #[test]
    fn if_not_found_lazy() {
        // The fallback's error surfaces only on a miss.
        let hit = eval_with(&table(), r#"=XLOOKUP("b",A1:A3,B1:B3,1/0)"#);
        assert_eq!(n(&hit), 20.0);
        let miss = eval_with(&table(), r#"=XLOOKUP("z",A1:A3,B1:B3,1/0)"#);
        assert_eq!(e(&miss), CalcError::DivZero);
    }

    #[test]
    fn next_smaller() {
        let v = eval_with(&table(), r#"=XLOOKUP("bb",A1:A3,B1:B3,,-1)"#);
        assert_eq!(n(&v), 20.0); // "b" is the largest key < "bb"
    }

    #[test]
    fn next_larger() {
        let v = eval_with(&table(), r#"=XLOOKUP("bb",A1:A3,B1:B3,,1)"#);
        assert_eq!(n(&v), 30.0); // "c" is the smallest key > "bb"
    }

    #[test]
    fn wildcard_mode() {
        let v = eval_with(
            &[
                ("A1", "apple".into()),
                ("A2", "banana".into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            r#"=XLOOKUP("b*n*",A1:A2,B1:B2,,2)"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn search_last_to_first() {
        let v = eval_with(
            &[
                ("A1", "x".into()),
                ("A2", "x".into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            r#"=XLOOKUP("x",A1:A2,B1:B2,,0,-1)"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn binary_search_modes() {
        let asc = vec![
            ("A1", 1.0.into()),
            ("A2", 2.0.into()),
            ("A3", 3.0.into()),
            ("B1", 10.0.into()),
            ("B2", 20.0.into()),
            ("B3", 30.0.into()),
        ];
        assert_eq!(n(&eval_with(&asc, "=XLOOKUP(2,A1:A3,B1:B3,,0,2)")), 20.0);
        let desc = vec![
            ("A1", 3.0.into()),
            ("A2", 2.0.into()),
            ("A3", 1.0.into()),
            ("B1", 30.0.into()),
            ("B2", 20.0.into()),
            ("B3", 10.0.into()),
        ];
        assert_eq!(n(&eval_with(&desc, "=XLOOKUP(2,A1:A3,B1:B3,,0,-2)")), 20.0);
    }

    #[test]
    fn length_mismatch() {
        assert_eq!(
            e(&eval_with(&table(), r#"=XLOOKUP("b",A1:A3,B1:B2)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn invalid_modes() {
        assert_eq!(
            e(&eval_with(&table(), r#"=XLOOKUP("b",A1:A3,B1:B3,,9)"#)),
            CalcError::Value
        );
        assert_eq!(
            e(&eval_with(&table(), r#"=XLOOKUP("b",A1:A3,B1:B3,,0,9)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn two_d_lookup_array_is_value_error() {
        let v = eval_with(&table(), r#"=XLOOKUP("b",A1:B3,B1:B3)"#);
        assert_eq!(e(&v), CalcError::Value);
    }

    #[test]
    fn row_vector_lookup() {
        let v = eval_with(
            &[
                ("A1", "x".into()),
                ("B1", "y".into()),
                ("A2", 1.0.into()),
                ("B2", 2.0.into()),
            ],
            r#"=XLOOKUP("y",A1:B1,A2:B2)"#,
        );
        assert_eq!(n(&v), 2.0);
    }

    #[test]
    fn wide_return_array_gives_row_slice() {
        let v = eval_with(
            &[
                ("A1", "a".into()),
                ("A2", "b".into()),
                ("B1", 1.0.into()),
                ("B2", 2.0.into()),
                ("C1", 10.0.into()),
                ("C2", 20.0.into()),
            ],
            r#"=XLOOKUP("b",A1:A2,B1:C2)"#,
        );
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!((a.rows(), a.cols()), (1, 2));
        assert_eq!(a.get(0, 1), Some(&Value::Number(20.0)));
    }
}
