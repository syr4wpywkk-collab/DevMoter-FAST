//! `BYCOL(array, LAMBDA)` — applies a LAMBDA to each column of `array`
//! and returns a single-row array of the per-column results.
//! Spec: `docs/functions/BYCOL.md`.
//!
//! Each column passes to the lambda as a `rows x 1` `Value::Array`.
//! Result shape is `1 x columns(array)`. Lambda invocations consume the
//! shared step budget via [`EvalContext::call_lambda`].
//!
//! SPEC-OPEN: a lambda returning more than one value per column becomes
//! that element's `#CALC!` error (error kind unconfirmed vs `#VALUE!`);
//! errors inside a column's call are element-wise (Excel may fail the
//! whole call instead — same question as `MAP`).

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let Value::Lambda(lam) = ctx.eval(&args[1])? else {
        return Ok(Value::Error(CalcError::Value));
    };
    if lam.params.len() != 1 {
        return Ok(Value::Error(CalcError::Value));
    }
    let arr = match coercion::eval_array(ctx, &args[0])? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(a) => a,
    };
    let (rows, cols) = (arr.rows(), arr.cols());
    let mut out = Vec::with_capacity(cols as usize);
    for j in 0..cols {
        let column = (0..rows)
            .map(|i| arr.get(i, j).unwrap().clone())
            .collect::<Vec<_>>();
        let col_arr = match ArrayValue::from_column(column) {
            Ok(a) => a,
            Err(e) => return Ok(Value::Error(e)),
        };
        match ctx.call_lambda(&lam, vec![Value::Array(col_arr)])? {
            Value::Array(_) => out.push(Value::Error(CalcError::Calc)),
            v => out.push(v),
        }
    }
    match ArrayValue::from_row(out) {
        Ok(a) => Ok(Value::Array(a)),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn nums(v: &Value) -> Vec<f64> {
        match v {
            Value::Array(a) => a
                .cells()
                .iter()
                .map(|c| match c {
                    Value::Number(n) => *n,
                    o => panic!("expected number, got {o:?}"),
                })
                .collect(),
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
    fn spec_example_column_sums() {
        let v = eval("=BYCOL({1,2,3;4,5,6},LAMBDA(c,SUM(c)))");
        assert_eq!(nums(&v), vec![5.0, 7.0, 9.0]);
        let Value::Array(a) = v else { panic!() };
        assert_eq!((a.rows(), a.cols()), (1, 3));
    }

    #[test]
    fn single_column() {
        assert_eq!(nums(&eval("=BYCOL({2;4},LAMBDA(c,MAX(c)))")), vec![4.0]);
    }

    #[test]
    fn over_range() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("B1", 2.0.into()),
                ("A2", 3.0.into()),
                ("B2", 4.0.into()),
            ],
            "=BYCOL(A1:B2,LAMBDA(c,SUM(c)))",
        );
        assert_eq!(nums(&v), vec![4.0, 6.0]);
    }

    #[test]
    fn lambda_sees_column_vector() {
        // ROWS(c) reports the column height.
        let v = eval("=BYCOL({1,2;3,4;5,6},LAMBDA(c,ROWS(c)))");
        assert_eq!(nums(&v), vec![3.0, 3.0]);
    }

    #[test]
    fn lambda_arity_must_be_one() {
        assert_eq!(e(&eval("=BYCOL({1,2},LAMBDA(a,b,a))")), CalcError::Value);
    }

    #[test]
    fn non_lambda_rejected() {
        assert_eq!(e(&eval("=BYCOL({1,2},5)")), CalcError::Value);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=BYCOL({1,2})")), CalcError::Value);
        assert_eq!(e(&eval("=BYCOL({1,2},LAMBDA(c,c),1)")), CalcError::Value);
    }

    #[test]
    fn array_arg_error_propagates() {
        assert_eq!(e(&eval("=BYCOL(1/0,LAMBDA(c,c))")), CalcError::DivZero);
    }

    #[test]
    fn element_errors_are_elementwise() {
        // SPEC-OPEN: error in one column becomes that element's value.
        let v = eval("=BYCOL({1,0},LAMBDA(c,1/SUM(c)))");
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[0], Value::Number(1.0));
        assert_eq!(a.cells()[1], Value::Error(CalcError::DivZero));
    }

    #[test]
    fn multi_value_lambda_calc_error() {
        // SPEC-OPEN: kind unconfirmed; engine reports #CALC! per spec.
        let v = eval("=BYCOL({1,2},LAMBDA(c,{1,2}))");
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[0], Value::Error(CalcError::Calc));
        assert_eq!(a.cells()[1], Value::Error(CalcError::Calc));
    }

    #[test]
    fn text_results() {
        let v = eval(r#"=BYCOL({"a","b"},LAMBDA(c,INDEX(c,1)&"!"))"#);
        let Value::Array(a) = v else { panic!() };
        assert_eq!(a.cells()[0], Value::Text("a!".into()));
        assert_eq!(a.cells()[1], Value::Text("b!".into()));
    }

    #[test]
    fn closure_over_let() {
        let v = eval("=LET(k,10,BYCOL({1,2},LAMBDA(c,SUM(c)+k)))");
        assert_eq!(nums(&v), vec![11.0, 12.0]);
    }
}
