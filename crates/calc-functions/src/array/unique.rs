//! `UNIQUE(array, [by_col], [exactly_once])` — distinct rows/columns in
//! first-occurrence order. Spec: `docs/functions/UNIQUE.md`.

use crate::common::{coercion, compare};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 3) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let by_col = match flag_arg(ctx, args.get(1))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };
    let exactly_once = match flag_arg(ctx, args.get(2))? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(b) => b,
    };

    // Items are rows (by_col=FALSE) or columns (TRUE), each `width`
    // elements wide.
    let (items, width) = if by_col {
        (a.cols(), a.rows())
    } else {
        (a.rows(), a.cols())
    };
    // First pass: count occurrences so `exactly_once` can filter.
    let mut order: Vec<u32> = Vec::with_capacity(items as usize);
    let mut counts: Vec<u32> = Vec::with_capacity(items as usize);
    for i in 0..items {
        let found = order
            .iter()
            .enumerate()
            .find(|&(_, &j)| item_eq(&a, i, j, width, by_col));
        match found {
            Some((k, _)) => counts[k] += 1,
            None => {
                order.push(i);
                counts.push(1);
            }
        }
    }

    let survivors: Vec<u32> = order
        .iter()
        .zip(&counts)
        .filter(|&(_, &n)| !exactly_once || n == 1)
        .map(|(&i, _)| i)
        .collect();
    if survivors.is_empty() {
        // Empty array (nothing survived exactly_once) — not
        // representable; Excel returns `#CALC!` (UNIQUE.md).
        return Ok(Value::Error(CalcError::Calc));
    }

    let (rows, cols) = if by_col {
        (a.rows(), survivors.len() as u32)
    } else {
        (survivors.len() as u32, a.cols())
    };
    let mut cells = Vec::with_capacity(rows as usize * cols as usize);
    for r in 0..rows {
        for c in 0..cols {
            // Row-major emission; by_col selects surviving columns.
            let v = if by_col {
                a.get(r, survivors[c as usize]).expect("in bounds")
            } else {
                a.get(survivors[r as usize], c).expect("in bounds")
            };
            cells.push(v.clone());
        }
    }
    match ArrayValue::new(rows, cols, cells) {
        Ok(u) => Ok(Value::Array(u)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Elementwise equality of items `i` and `j` (rows or columns of `a`).
/// Errors dedupe by error kind; other values use `=` semantics
/// (case-insensitive text, blank == "" and blank == 0 — UNIQUE.md
/// SPEC-OPEN items).
fn item_eq(a: &ArrayValue, i: u32, j: u32, width: u32, by_col: bool) -> bool {
    (0..width).all(|k| {
        let (l, r) = if by_col {
            (a.get(k, i), a.get(k, j))
        } else {
            (a.get(i, k), a.get(j, k))
        };
        match (l, r) {
            (Some(Value::Error(x)), Some(Value::Error(y))) => x == y,
            (Some(l), Some(r)) => compare::scalar_eq(l, r),
            _ => false,
        }
    })
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
    fn dedupes_column() {
        let (r, c, cells) = arr(&eval("=UNIQUE({1;2;1;3;2})"));
        assert_eq!((r, c), (3, 1));
        assert_eq!(
            cells,
            vec![Value::Number(1.0), Value::Number(2.0), Value::Number(3.0)]
        );
    }

    #[test]
    fn first_occurrence_order() {
        let (_, _, cells) = arr(&eval("=UNIQUE({3;1;3;1;2})"));
        assert_eq!(
            cells,
            vec![Value::Number(3.0), Value::Number(1.0), Value::Number(2.0)]
        );
    }

    #[test]
    fn dedupes_rows() {
        let (r, c, cells) = arr(&eval("=UNIQUE({1,2;3,4;1,2})"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[2], Value::Number(3.0));
    }

    #[test]
    fn by_col() {
        let (r, c, cells) = arr(&eval("=UNIQUE({1,2,1;3,4,3},TRUE)"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[1], Value::Number(2.0));
        assert_eq!(cells[2], Value::Number(3.0));
    }

    #[test]
    fn text_dedupes_case_insensitively() {
        let (_, _, cells) = arr(&eval(r#"=UNIQUE({"A";"a";"B"})"#));
        assert_eq!(
            cells,
            vec![Value::Text("A".to_string()), Value::Text("B".to_string())]
        );
    }

    #[test]
    fn number_one_differs_from_true() {
        let (_, _, cells) = arr(&eval("=UNIQUE({1;TRUE})"));
        assert_eq!(cells.len(), 2);
    }

    #[test]
    fn errors_dedupe_by_kind() {
        let (_, _, cells) = arr(&eval("=UNIQUE({#N/A;#N/A;#DIV/0!})"));
        assert_eq!(
            cells,
            vec![
                Value::Error(CalcError::NA),
                Value::Error(CalcError::DivZero)
            ]
        );
    }

    #[test]
    fn exactly_once() {
        let (_, _, cells) = arr(&eval("=UNIQUE({1;2;1;3;2},,TRUE)"));
        assert_eq!(cells, vec![Value::Number(3.0)]);
    }

    #[test]
    fn exactly_once_empty_is_calc() {
        assert_eq!(e(&eval("=UNIQUE({1;1},,TRUE)")), CalcError::Calc);
    }

    #[test]
    fn single_cell() {
        let (r, c, cells) = arr(&eval("=UNIQUE(7)"));
        assert_eq!((r, c), (1, 1));
        assert_eq!(cells, vec![Value::Number(7.0)]);
    }

    #[test]
    fn all_distinct() {
        let (r, _, _) = arr(&eval("=UNIQUE({1;2;3})"));
        assert_eq!(r, 3);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=UNIQUE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=UNIQUE()")), CalcError::Value);
        assert_eq!(e(&eval("=UNIQUE({1},FALSE,FALSE,FALSE)")), CalcError::Value);
    }

    #[test]
    fn range_input() {
        let v = eval_with(
            &[("A1", 5.0.into()), ("A2", 5.0.into()), ("A3", 6.0.into())],
            "=UNIQUE(A1:A3)",
        );
        let (r, _, _) = arr(&v);
        assert_eq!(r, 2);
    }
}
