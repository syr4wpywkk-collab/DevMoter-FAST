//! `FILTER(array, include, [if_empty])` — rows/columns whose `include`
//! entry is truthy. Spec: `docs/functions/FILTER.md`.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let include = match coercion::eval_array(ctx, &args[1])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(i) => i,
    };

    // `include` must be a 1-D vector matching one axis of `array`: a
    // column vector of `rows` entries filters rows, a row vector of
    // `cols` entries filters columns (FILTER.md).
    let (by_row, len) = if include.cols() == 1 && include.rows() == a.rows() {
        (true, a.rows())
    } else if include.rows() == 1 && include.cols() == a.cols() {
        (false, a.cols())
    } else {
        return Ok(Value::Error(CalcError::Value));
    };

    let mut keep = Vec::with_capacity(len as usize);
    for i in 0..len {
        let v = if by_row {
            include.get(i, 0).expect("in bounds")
        } else {
            include.get(0, i).expect("in bounds")
        };
        // Truthiness: booleans direct, numbers nonzero; text (incl.
        // numeric text) and blanks are `#VALUE!` per FILTER.md
        // (SPEC-OPEN: falsy-vs-error for text entries).
        let k = match v {
            Value::Boolean(b) => *b,
            Value::Number(n) => *n != 0.0,
            Value::Error(e) => return Ok(Value::Error(*e)),
            _ => return Ok(Value::Error(CalcError::Value)),
        };
        keep.push(k);
    }

    let kept: Vec<u32> = (0..len).filter(|&i| keep[i as usize]).collect();
    if kept.is_empty() {
        // `if_empty` replaces the empty result; omitted -> `#CALC!`.
        return match args.get(2) {
            Some(Expr::Missing) | None => Ok(Value::Error(CalcError::Calc)),
            Some(e) => {
                let v = ctx.eval(e)?;
                Ok(v)
            }
        };
    }

    let (rows, cols) = if by_row {
        (kept.len() as u32, a.cols())
    } else {
        (a.rows(), kept.len() as u32)
    };
    let mut cells = Vec::with_capacity(rows as usize * cols as usize);
    for r in 0..rows {
        for c in 0..cols {
            let v = if by_row {
                a.get(kept[r as usize], c).expect("in bounds")
            } else {
                a.get(r, kept[c as usize]).expect("in bounds")
            };
            cells.push(v.clone());
        }
    }
    match ArrayValue::new(rows, cols, cells) {
        Ok(f) => Ok(Value::Array(f)),
        Err(e) => Ok(Value::Error(e)),
    }
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
    fn filters_rows() {
        let (r, c, cells) = arr(&eval("=FILTER({1,10;2,20;3,30},{1;0;1})"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[0], Value::Number(1.0));
        assert_eq!(cells[2], Value::Number(3.0));
    }

    #[test]
    fn filters_columns() {
        let (r, c, cells) = arr(&eval("=FILTER({1,2,3;4,5,6},{0,1,1})"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[0], Value::Number(2.0));
        assert_eq!(cells[2], Value::Number(5.0));
    }

    #[test]
    fn numeric_include() {
        // Nonzero numbers count as TRUE (FILTER.md).
        let (r, _, _) = arr(&eval("=FILTER({1;2;3},{-1;0;0.5})"));
        assert_eq!(r, 2);
    }

    #[test]
    fn stable_order() {
        let (_, _, cells) = arr(&eval("=FILTER({3;1;2},{1;1;1})"));
        assert_eq!(
            cells,
            vec![Value::Number(3.0), Value::Number(1.0), Value::Number(2.0)]
        );
    }

    #[test]
    fn empty_is_calc_error() {
        assert_eq!(e(&eval("=FILTER({1;2},{0;0})")), CalcError::Calc);
    }

    #[test]
    fn if_empty_fallback() {
        let v = eval(r#"=FILTER({1;2},{0;0},"none")"#);
        assert_eq!(v, Value::Text("none".to_string()));
    }

    #[test]
    fn if_empty_can_be_array() {
        let (r, c, _) = arr(&eval("=FILTER({1;2},{0;0},{9,9})"));
        assert_eq!((r, c), (1, 2));
    }

    #[test]
    fn length_mismatch() {
        assert_eq!(e(&eval("=FILTER({1;2;3},{1;0})")), CalcError::Value);
        assert_eq!(e(&eval("=FILTER({1,2},{1,0,1})")), CalcError::Value);
    }

    #[test]
    fn two_d_include_rejected() {
        assert_eq!(e(&eval("=FILTER({1,2;3,4},{1,0;0,1})")), CalcError::Value);
    }

    #[test]
    fn text_in_include_is_value_error() {
        assert_eq!(e(&eval(r#"=FILTER({1;2},{"x";1})"#)), CalcError::Value);
        // Blank entries are `#VALUE!` too under the current rule.
        assert_eq!(e(&eval("=FILTER({1;2},A1:A2)")), CalcError::Value);
    }

    #[test]
    fn include_error_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA))],
            "=FILTER({1;2},{1;A1})",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn array_error_elements_survive() {
        let (_, _, cells) = arr(&eval("=FILTER({#N/A;2},{1;1})"));
        assert_eq!(cells[0], Value::Error(CalcError::NA));
    }

    #[test]
    fn error_args_propagate() {
        assert_eq!(e(&eval("=FILTER(1/0,{1})")), CalcError::DivZero);
        assert_eq!(e(&eval("=FILTER({1},1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=FILTER({1})")), CalcError::Value);
        assert_eq!(e(&eval("=FILTER({1},{1},0,0)")), CalcError::Value);
    }

    #[test]
    fn range_input() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", 2.0.into()),
                ("B1", Value::Boolean(true)),
                ("B2", Value::Boolean(false)),
            ],
            "=FILTER(A1:A2,B1:B2)",
        );
        let (r, _, cells) = arr(&v);
        assert_eq!(r, 1);
        assert_eq!(cells, vec![Value::Number(1.0)]);
    }
}
