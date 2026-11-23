//! `XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])` —
//! 1-based position of `lookup_value` inside a vector. Spec:
//! `docs/functions/XMATCH.md`.
//!
//! Unlike `MATCH` the default `match_mode` is exact (`0`). Approximate
//! modes `-1`/`1` scan the whole vector per the XMATCH docs ("works
//! regardless of sort order"), returning the best `<=`/`>=` element;
//! `search_mode` only picks which *equal-best* position wins. Binary
//! `search_mode`s assume sorted input (unspecified otherwise).

use crate::common::{coercion, lookup};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;
use std::cmp::Ordering;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 4) {
        return Ok(Value::Error(e));
    }
    let needle = ctx.eval(&args[0])?;
    if let Some(e) = needle.error() {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    if a.rows() > 1 && a.cols() > 1 {
        // The lookup array must be a vector; `#N/A` per XMATCH.md.
        return Ok(Value::Error(CalcError::NA));
    }
    let match_mode = match mode(ctx, args.get(2), 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(m) => m,
    };
    if !(-1..=2).contains(&match_mode) {
        return Ok(Value::Error(CalcError::Value));
    }
    let search_mode = match mode(ctx, args.get(3), 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(m) => m,
    };
    if !(-2..=2).contains(&search_mode) || search_mode == 0 {
        return Ok(Value::Error(CalcError::Value));
    }

    let cells: Vec<Value> = a.cells().to_vec();
    let rev = search_mode == -1;
    let pos = match match_mode {
        2 => {
            let wild = matches!(needle, Value::Text(_));
            if matches!(search_mode, 2 | -2) {
                binary_exact(&cells, &needle, search_mode == 2)
            } else {
                lookup::exact_position(&cells, &needle, wild, rev)
            }
        }
        0 => {
            if matches!(search_mode, 2 | -2) {
                binary_exact(&cells, &needle, search_mode == 2)
            } else {
                lookup::exact_position(&cells, &needle, false, rev)
            }
        }
        m => {
            let smaller = m == -1;
            match search_mode {
                2 | -2 => binary_approx(&cells, &needle, smaller, search_mode == 2),
                _ => scan_approx(&cells, &needle, smaller, rev),
            }
        }
    };
    match pos {
        Some(i) => Ok(Value::Number(i as f64 + 1.0)),
        None => Ok(Value::Error(CalcError::NA)),
    }
}

/// Linear scan for the best `<=` (smaller) / `>=` (larger) element.
/// `rev` selects the last equal-best position instead of the first.
fn scan_approx(cells: &[Value], needle: &Value, smaller: bool, rev: bool) -> Option<usize> {
    let mut best: Option<usize> = None;
    for (i, cell) in cells.iter().enumerate() {
        if cell.is_error() {
            continue;
        }
        let ord = lookup::compare(cell, needle);
        let eligible = if smaller {
            ord != Ordering::Greater
        } else {
            ord != Ordering::Less
        };
        if !eligible {
            continue;
        }
        best = match best {
            None => Some(i),
            Some(b) => {
                // Rank the candidate against the current best cell, not
                // against the needle: every eligible cell compares the
                // same way to `needle`, so `ord`/`bo` cannot order them.
                let rel = lookup::compare(cell, &cells[b]);
                let better = if smaller {
                    rel == Ordering::Greater
                } else {
                    rel == Ordering::Less
                };
                if better || (rel == Ordering::Equal && rev) {
                    Some(i)
                } else {
                    Some(b)
                }
            }
        };
    }
    best
}

/// Exact match under binary search over assumed-sorted input.
fn binary_exact(cells: &[Value], needle: &Value, asc: bool) -> Option<usize> {
    let i = if asc {
        lookup::approx_asc(cells, needle)?
    } else {
        lookup::approx_desc(cells, needle)?
    };
    lookup::exact_eq(needle, &cells[i]).then_some(i)
}

/// Approximate match via binary search over assumed-sorted input.
fn binary_approx(cells: &[Value], needle: &Value, smaller: bool, asc: bool) -> Option<usize> {
    let i = if asc {
        lookup::approx_asc(cells, needle)?
    } else {
        lookup::approx_desc(cells, needle)?
    };
    // approx_* already land on the `<=`/`>=` candidate for their sort
    // order; flip to the opposite candidate when `smaller` disagrees.
    let ord = lookup::compare(&cells[i], needle);
    if (smaller && ord == Ordering::Greater) || (!smaller && ord == Ordering::Less) {
        None
    } else {
        Some(i)
    }
}

/// Optional integer arg (`Expr::Missing`/blank -> `default`).
fn mode(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    default: i64,
) -> Result<Result<i64, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(default)),
        Some(e) => ctx.eval(e)?,
    };
    if v.is_blank() {
        return Ok(Ok(default));
    }
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    Ok(v.to_number().map(|n| n.trunc() as i64))
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

    #[test]
    fn exact_default() {
        assert_eq!(n(&eval(r#"=XMATCH("b",{"a","b","c"})"#)), 2.0);
    }

    #[test]
    fn exact_is_case_insensitive() {
        assert_eq!(n(&eval(r#"=XMATCH("B",{"a","b","c"})"#)), 2.0);
    }

    #[test]
    fn next_larger() {
        assert_eq!(n(&eval("=XMATCH(4,{1,3,5,7},1)")), 3.0);
    }

    #[test]
    fn next_smaller() {
        assert_eq!(n(&eval("=XMATCH(4,{1,3,5,7},-1)")), 2.0);
    }

    #[test]
    fn next_smaller_and_larger_edges() {
        assert_eq!(n(&eval("=XMATCH(9,{1,3,5},-1)")), 3.0);
        assert_eq!(e(&eval("=XMATCH(9,{1,3,5},1)")), CalcError::NA);
        assert_eq!(e(&eval("=XMATCH(0,{1,3,5},-1)")), CalcError::NA);
    }

    #[test]
    fn wildcard_match() {
        assert_eq!(n(&eval(r#"=XMATCH("b*",{"apple","banana"},2)"#)), 2.0);
        assert_eq!(n(&eval(r#"=XMATCH("a?ple",{"apple","banana"},2)"#)), 1.0);
    }

    #[test]
    fn reverse_search() {
        assert_eq!(n(&eval(r#"=XMATCH("b",{"a","b","b"},,-1)"#)), 3.0);
        assert_eq!(n(&eval(r#"=XMATCH("b",{"a","b","b"},,1)"#)), 2.0);
    }

    #[test]
    fn binary_modes() {
        assert_eq!(n(&eval("=XMATCH(5,{1,3,5,7},0,2)")), 3.0);
        assert_eq!(n(&eval("=XMATCH(5,{7,5,3,1},0,-2)")), 2.0);
        assert_eq!(n(&eval("=XMATCH(4,{1,3,5,7},-1,2)")), 2.0);
    }

    #[test]
    fn not_found() {
        assert_eq!(e(&eval(r#"=XMATCH("z",{"a","b"})"#)), CalcError::NA);
    }

    #[test]
    fn invalid_modes() {
        assert_eq!(e(&eval("=XMATCH(1,{1},3)")), CalcError::Value);
        assert_eq!(e(&eval("=XMATCH(1,{1},-2)")), CalcError::Value);
        assert_eq!(e(&eval("=XMATCH(1,{1},0,0)")), CalcError::Value);
        assert_eq!(e(&eval("=XMATCH(1,{1},0,3)")), CalcError::Value);
    }

    #[test]
    fn two_dimensional_array() {
        assert_eq!(e(&eval("=XMATCH(1,{1,2;3,4})")), CalcError::NA);
    }

    #[test]
    fn column_vector() {
        assert_eq!(n(&eval("=XMATCH(3,{1;3;5})")), 2.0);
    }

    #[test]
    fn cross_type_never_matches() {
        assert_eq!(e(&eval(r#"=XMATCH("5",{3,5,7})"#)), CalcError::NA);
        assert_eq!(e(&eval("=XMATCH(5,{TRUE,FALSE})")), CalcError::NA);
    }

    #[test]
    fn errors_propagate() {
        assert_eq!(e(&eval("=XMATCH(1/0,{1})")), CalcError::DivZero);
        assert_eq!(e(&eval("=XMATCH(1,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=XMATCH(1)")), CalcError::Value);
        assert_eq!(e(&eval("=XMATCH(1,{1},0,1,0)")), CalcError::Value);
    }
}
