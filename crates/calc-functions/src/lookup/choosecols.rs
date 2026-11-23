//! `CHOOSECOLS(array, col_num1, [col_num2], ...)` — the selected
//! columns of `array`, in the order given. Negative indexes count from
//! the right edge. Spec: `docs/functions/CHOOSECOLS.md`.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, usize::MAX) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let cols = match indexes(ctx, &args[1..], a.cols())? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(c) => c,
    };
    let mut cells = Vec::with_capacity(a.rows() as usize * cols.len());
    for r in 0..a.rows() {
        for &c in &cols {
            cells.push(a.get(r, c).expect("index validated").clone());
        }
    }
    match ArrayValue::new(a.rows(), cols.len() as u32, cells) {
        Ok(t) => Ok(Value::Array(t)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Evaluate each index arg to a 0-based column index (truncated;
/// negatives count from the right). `0`/out-of-range -> `#VALUE!`.
fn indexes(
    ctx: &mut EvalContext<'_>,
    exprs: &[Expr],
    width: u32,
) -> Result<Result<Vec<u32>, CalcError>, EvalError> {
    let mut out = Vec::with_capacity(exprs.len());
    for e in exprs {
        let v = ctx.eval(e)?;
        if let Some(err) = v.error() {
            return Ok(Err(err));
        }
        let n = match v.to_number() {
            Ok(n) => n.trunc() as i64,
            Err(err) => return Ok(Err(err)),
        };
        let w = i64::from(width);
        if n == 0 || n > w || n < -w {
            return Ok(Err(CalcError::Value));
        }
        out.push(if n > 0 { n - 1 } else { w + n } as u32);
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
    fn picks_two_columns() {
        let (r, c, cells) = arr(&eval("=CHOOSECOLS({1,2,3;4,5,6},1,3)"));
        assert_eq!((r, c), (2, 2));
        assert_eq!(
            cells,
            vec![
                Value::Number(1.0),
                Value::Number(3.0),
                Value::Number(4.0),
                Value::Number(6.0)
            ]
        );
    }

    #[test]
    fn negative_index_counts_from_right() {
        let (_, _, cells) = arr(&eval("=CHOOSECOLS({1,2,3;4,5,6},-1)"));
        assert_eq!(cells, vec![Value::Number(3.0), Value::Number(6.0)]);
    }

    #[test]
    fn repeats_and_reorders() {
        let (_, c, cells) = arr(&eval("=CHOOSECOLS({1,2,3;4,5,6},3,1,3)"));
        assert_eq!(c, 3);
        assert_eq!(cells[0], Value::Number(3.0));
        assert_eq!(cells[1], Value::Number(1.0));
        assert_eq!(cells[2], Value::Number(3.0));
    }

    #[test]
    fn out_of_range_index() {
        assert_eq!(e(&eval("=CHOOSECOLS({1,2,3},4)")), CalcError::Value);
        assert_eq!(e(&eval("=CHOOSECOLS({1,2,3},-4)")), CalcError::Value);
        assert_eq!(e(&eval("=CHOOSECOLS({1,2,3},0)")), CalcError::Value);
    }

    #[test]
    fn scalar_first_arg_is_1x1() {
        let v = eval("=CHOOSECOLS(7,1)");
        assert_eq!(
            match v {
                Value::Array(a) => a.get(0, 0).cloned(),
                o => panic!("expected array, got {o:?}"),
            },
            Some(Value::Number(7.0))
        );
    }

    #[test]
    fn range_argument() {
        let v = eval_with(
            &[("A1", Value::Number(1.0)), ("B1", Value::Number(2.0))],
            "=CHOOSECOLS(A1:B1,2)",
        );
        let (_, _, cells) = arr(&v);
        assert_eq!(cells, vec![Value::Number(2.0)]);
    }

    #[test]
    fn error_in_selected_column_propagates() {
        let (_, _, cells) = arr(&eval("=CHOOSECOLS({1,2;3,#N/A},2)"));
        assert_eq!(cells[1], Value::Error(CalcError::NA));
    }

    #[test]
    fn error_in_unselected_column_dropped() {
        let (_, _, cells) = arr(&eval("=CHOOSECOLS({#N/A,2;#DIV/0!,4},2)"));
        assert_eq!(cells, vec![Value::Number(2.0), Value::Number(4.0)]);
    }

    #[test]
    fn fractional_index_truncates() {
        let (_, _, cells) = arr(&eval("=CHOOSECOLS({1,2,3},2.9)"));
        assert_eq!(cells, vec![Value::Number(2.0)]);
    }

    #[test]
    fn text_number_coerces() {
        let (_, _, cells) = arr(&eval(r#"=CHOOSECOLS({1,2,3},"2")"#));
        assert_eq!(cells, vec![Value::Number(2.0)]);
    }

    #[test]
    fn arg_errors_propagate() {
        assert_eq!(e(&eval("=CHOOSECOLS(1/0,1)")), CalcError::DivZero);
        assert_eq!(e(&eval("=CHOOSECOLS({1,2},1/0)")), CalcError::DivZero);
        assert_eq!(e(&eval("=CHOOSECOLS({1,2},#N/A)")), CalcError::NA);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=CHOOSECOLS({1,2})")), CalcError::Value);
        assert_eq!(e(&eval("=CHOOSECOLS()")), CalcError::Value);
    }
}
