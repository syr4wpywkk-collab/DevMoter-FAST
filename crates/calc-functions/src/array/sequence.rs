//! `SEQUENCE(rows, [columns], [start], [step])` — sequential numbers as
//! a row-major array. Spec: `docs/functions/SEQUENCE.md`.

use crate::common::coercion;
use calc_core::array::{ArrayValue, MAX_ARRAY_CELLS};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 4) {
        return Ok(Value::Error(e));
    }
    let rows = match int_arg(ctx, args.first(), 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let cols = match int_arg(ctx, args.get(1), 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let start = match num_arg(ctx, args.get(2), 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    let step = match num_arg(ctx, args.get(3), 1.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(n) => n,
    };
    if rows < 1 || cols < 1 {
        return Ok(Value::Error(CalcError::Num));
    }
    if rows as u64 * cols as u64 > MAX_ARRAY_CELLS as u64 {
        // SPEC-OPEN: error kind for the array-size cap is undecided
        // (SPEC-OPEN item 6); `#NUM!` chosen for consistency with the
        // rows/cols < 1 rejection above.
        return Ok(Value::Error(CalcError::Num));
    }
    let mut cells = Vec::with_capacity((rows * cols) as usize);
    for i in 0..(rows * cols) {
        cells.push(Value::Number(start + step * i as f64));
    }
    match ArrayValue::new(rows as u32, cols as u32, cells) {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
    }
}

/// Optional count argument, truncated toward zero; `Missing`/blank
/// yields `default`.
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
            i64::MAX // non-finite counts fail the bound checks below
        }
    }))
}

/// Optional real-valued argument; `Missing`/blank yields `default`.
fn num_arg(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    default: f64,
) -> Result<Result<f64, CalcError>, EvalError> {
    match expr {
        Some(Expr::Missing) | None => Ok(Ok(default)),
        Some(e) => coercion::eval_number(ctx, e),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcEngine, CalcError, CellInput, Value};

    fn arr(v: &Value) -> Vec<Vec<Value>> {
        match v {
            Value::Array(a) => (0..a.rows())
                .map(|r| {
                    (0..a.cols())
                        .map(|c| a.get(r, c).unwrap().clone())
                        .collect()
                })
                .collect(),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn nums(rows: Vec<Vec<f64>>) -> Vec<Vec<Value>> {
        rows.into_iter()
            .map(|r| r.into_iter().map(Value::Number).collect())
            .collect()
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn basic() {
        assert_eq!(
            arr(&eval("=SEQUENCE(2,3,1,1)")),
            nums(vec![vec![1., 2., 3.], vec![4., 5., 6.]])
        );
    }

    #[test]
    fn defaults() {
        assert_eq!(
            arr(&eval("=SEQUENCE(3)")),
            nums(vec![vec![1.], vec![2.], vec![3.]])
        );
        assert_eq!(
            arr(&eval("=SEQUENCE(2,2)")),
            nums(vec![vec![1., 2.], vec![3., 4.]])
        );
    }

    #[test]
    fn custom_start_step() {
        assert_eq!(
            arr(&eval("=SEQUENCE(3,1,10,-2)")),
            nums(vec![vec![10.], vec![8.], vec![6.]])
        );
    }

    #[test]
    fn fractional_step() {
        assert_eq!(
            arr(&eval("=SEQUENCE(1,3,0.5,0.25)")),
            nums(vec![vec![0.5, 0.75, 1.0]])
        );
    }

    #[test]
    fn fractional_counts_truncate() {
        assert_eq!(
            arr(&eval("=SEQUENCE(2.9,1.5)")),
            nums(vec![vec![1.], vec![2.]])
        );
    }

    #[test]
    fn zero_and_negative_counts() {
        assert_eq!(e(&eval("=SEQUENCE(0)")), CalcError::Num);
        assert_eq!(e(&eval("=SEQUENCE(2,0)")), CalcError::Num);
        assert_eq!(e(&eval("=SEQUENCE(-3)")), CalcError::Num);
    }

    #[test]
    fn non_numeric_args() {
        assert_eq!(e(&eval(r#"=SEQUENCE("x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=SEQUENCE(2,"x")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=SEQUENCE(2,2,"x")"#)), CalcError::Value);
    }

    #[test]
    fn error_arg_propagates() {
        assert_eq!(e(&eval("=SEQUENCE(1/0)")), CalcError::DivZero);
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=SEQUENCE()")), CalcError::Value);
        assert_eq!(e(&eval("=SEQUENCE(1,1,1,1,1)")), CalcError::Value);
    }

    #[test]
    fn cell_ref_args() {
        let v = eval_with(&[("A1", 3.0.into())], "=SEQUENCE(A1)");
        assert_eq!(arr(&v).len(), 3);
    }

    #[test]
    fn over_size_cap() {
        assert_eq!(e(&eval("=SEQUENCE(1001,1000)")), CalcError::Num);
    }

    #[test]
    fn spills_into_grid() {
        let mut eng = CalcEngine::new();
        eng.set_registry(Box::new(crate::registry::default_registry()));
        eng.add_sheet("Sheet1").unwrap();
        eng.set_cell("Sheet1", "B2", CellInput::from_typed("=SEQUENCE(2,2)"))
            .unwrap();
        assert_eq!(
            eng.get_value("Sheet1", "C3").unwrap(),
            Value::Number(4.0),
            "bottom-right element spilled"
        );
    }
}
