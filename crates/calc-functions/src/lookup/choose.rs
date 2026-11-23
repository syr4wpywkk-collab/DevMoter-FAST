//! `CHOOSE(index_num, value1, [value2], ...)` — select the
//! `index_num`-th argument. Spec: `docs/functions/CHOOSE.md`.
//!
//! Lazy like `IF`: only the selected argument is evaluated, so errors
//! in unselected arguments never surface. A selected range argument
//! evaluates to `Value::Array` (the engine has no reference type, so
//! the `SUM(CHOOSE(.., A1:A3, B1:B3))` idiom works through the array).

use crate::common::lookup::index_to_i64;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let idx = ctx.eval(&args[0])?;
    if let Some(e) = idx.error() {
        return Ok(Value::Error(e));
    }
    let idx = match index_to_i64(&idx) {
        Ok(i) => i,
        Err(e) => return Ok(Value::Error(e)),
    };
    let n = (args.len() - 1) as i64;
    if idx < 1 || idx > n {
        return Ok(Value::Error(CalcError::Value));
    }
    // Preserve the scalar/range distinction for the selected argument.
    Ok(ctx.eval_arg(&args[idx as usize])?.into_value())
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
    fn selects_nth() {
        assert_eq!(eval(r#"=CHOOSE(2,"a","b","c")"#), Value::Text("b".into()));
    }

    #[test]
    fn lazy_unselected_error() {
        // Only the selected argument is evaluated.
        assert_eq!(n(&eval("=CHOOSE(1,42,1/0)")), 42.0);
    }

    #[test]
    fn selected_error_propagates() {
        assert_eq!(e(&eval("=CHOOSE(2,42,1/0)")), CalcError::DivZero);
    }

    #[test]
    fn fractional_truncates() {
        assert_eq!(n(&eval("=CHOOSE(1.9,10,20)")), 10.0);
    }

    #[test]
    fn boolean_index_coerces() {
        assert_eq!(n(&eval("=CHOOSE(TRUE,10,20)")), 10.0);
    }

    #[test]
    fn text_index_coerces() {
        assert_eq!(n(&eval(r#"=CHOOSE("2",10,20)"#)), 20.0);
    }

    #[test]
    fn index_out_of_range() {
        assert_eq!(e(&eval("=CHOOSE(0,10,20)")), CalcError::Value);
        assert_eq!(e(&eval("=CHOOSE(3,10,20)")), CalcError::Value);
        assert_eq!(e(&eval("=CHOOSE(-1,10,20)")), CalcError::Value);
    }

    #[test]
    fn bad_index_coercion() {
        assert_eq!(e(&eval(r#"=CHOOSE("x",10,20)"#)), CalcError::Value);
    }

    #[test]
    fn range_result_becomes_array() {
        let v = eval_with(
            &[("B1", 7.0.into()), ("B2", 8.0.into())],
            "=CHOOSE(2,A1:A2,B1:B2)",
        );
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!((a.rows(), a.cols()), (2, 1));
        assert_eq!(a.get(0, 0), Some(&Value::Number(7.0)));
        assert_eq!(a.get(1, 0), Some(&Value::Number(8.0)));
    }

    #[test]
    fn index_error_propagates() {
        assert_eq!(e(&eval("=CHOOSE(1/0,10,20)")), CalcError::DivZero);
    }

    #[test]
    fn cell_index() {
        assert_eq!(
            n(&eval_with(&[("A1", 2.0.into())], "=CHOOSE(A1,10,20)")),
            20.0
        );
    }

    #[test]
    fn arity() {
        assert_eq!(e(&eval("=CHOOSE(1)")), CalcError::Value);
    }
}
