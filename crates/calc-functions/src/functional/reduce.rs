//! `REDUCE([initial_value], array, LAMBDA(acc, value))` — left fold.
//! Spec: `docs/functions/REDUCE.md`.
//!
//! The array is flattened in row-major order. With `initial_value` the
//! accumulator starts there; without it the first element seeds the
//! accumulator and folding continues from the second. Lambda invocations
//! consume the shared step budget via [`EvalContext::call_lambda`], so a
//! huge fold trips the budget error, never a hang.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let Value::Lambda(lam) = ctx.eval(args.last().unwrap())? else {
        return Ok(Value::Error(CalcError::Value));
    };
    if lam.params.len() != 2 {
        return Ok(Value::Error(CalcError::Value));
    }
    let (init_expr, array_expr) = if args.len() == 3 {
        (Some(&args[0]), &args[1])
    } else {
        (None, &args[0])
    };
    let arr = match ctx.eval_arg(array_expr)?.into_value() {
        Value::Array(a) => a,
        // A single scalar ref/value folds as a one-element array.
        v => match calc_core::array::ArrayValue::new(1, 1, vec![v]) {
            Ok(a) => a,
            Err(e) => return Ok(Value::Error(e)),
        },
    };
    let cells = arr.cells();
    let mut acc = match init_expr {
        Some(e) => ctx.eval(e)?,
        None => cells[0].clone(),
    };
    // An error accumulator short-circuits out (SPEC-OPEN: Excel may run
    // the remaining iterations instead).
    if acc.is_error() {
        return Ok(acc);
    }
    let start = if init_expr.is_some() { 0 } else { 1 };
    for v in &cells[start..] {
        acc = ctx.call_lambda(&lam, vec![acc, v.clone()])?;
        if acc.is_error() {
            return Ok(acc);
        }
    }
    Ok(acc)
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
    fn required_v2_fixture() {
        // docs/FUNCTION_PLAN_V2.md §5.1.
        assert_eq!(n(&eval("=REDUCE(0,{1,2,3},LAMBDA(a,v,a+v))")), 6.0);
    }

    #[test]
    fn over_range() {
        let v = eval_with(
            &[("A1", 1.0.into()), ("A2", 2.0.into()), ("A3", 3.0.into())],
            "=REDUCE(10,A1:A3,LAMBDA(a,v,a+v))",
        );
        assert_eq!(n(&v), 16.0);
    }

    #[test]
    fn row_major_order() {
        // Subtraction makes fold order observable.
        let v = eval("=REDUCE(0,{1,2;3,4},LAMBDA(a,v,a-v))");
        assert_eq!(n(&v), -10.0); // ((((0-1)-2)-3)-4)
    }

    #[test]
    fn no_initial_value() {
        // First element seeds the accumulator.
        assert_eq!(n(&eval("=REDUCE({1,2,3},LAMBDA(a,v,a+v))")), 6.0);
        assert_eq!(n(&eval("=REDUCE({2,3},LAMBDA(a,v,a*v))")), 6.0);
    }

    #[test]
    fn single_element_no_init() {
        assert_eq!(n(&eval("=REDUCE({7},LAMBDA(a,v,a+v))")), 7.0);
    }

    #[test]
    fn lambda_arity_error() {
        assert_eq!(e(&eval("=REDUCE(0,{1,2},LAMBDA(a,a))")), CalcError::Value);
    }

    #[test]
    fn non_lambda_rejected() {
        assert_eq!(e(&eval("=REDUCE(0,{1,2},42)")), CalcError::Value);
    }

    #[test]
    fn accumulator_error_short_circuits() {
        assert_eq!(
            e(&eval("=REDUCE(0,{1,0,2},LAMBDA(a,v,a/v))")),
            CalcError::DivZero
        );
    }

    #[test]
    fn initial_error_propagates() {
        assert_eq!(
            e(&eval("=REDUCE(1/0,{1,2},LAMBDA(a,v,a+v))")),
            CalcError::DivZero
        );
    }

    #[test]
    fn text_accumulation() {
        let v = eval(r#"=REDUCE("",{"a","b","c"},LAMBDA(a,v,a&v))"#);
        assert_eq!(v, Value::Text("abc".into()));
    }

    #[test]
    fn closure_over_let() {
        let v = eval("=LET(k,2,REDUCE(0,{1,2,3},LAMBDA(a,v,a+v*k)))");
        assert_eq!(n(&v), 12.0);
    }

    #[test]
    fn array_accumulator() {
        // acc may itself be an array (the fold state need not be scalar).
        let v = eval("=REDUCE({0},{1,2,3},LAMBDA(a,v,{v}))");
        let Value::Array(a) = v else {
            panic!("expected array, got {v:?}")
        };
        assert_eq!(a.cells(), &[Value::Number(3.0)]);
    }
}
