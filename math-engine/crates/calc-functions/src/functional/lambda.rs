//! `LAMBDA(param1, [param2], ..., calculation)` — anonymous function
//! value. Spec: `docs/functions/LAMBDA.md`.
//!
//! `LAMBDA(...)` evaluates to `Value::Lambda`, capturing the enclosing
//! `LET` scope as a closure. Invocation sites: a bound name used as a
//! call (`f(5)`), the postfix invoke form `LAMBDA(x,x+1)(5)`, and
//! higher-order functions (`MAP`, `REDUCE`). A lambda that reaches a cell
//! boundary becomes `#VALUE!`; arity mismatch at call is `#VALUE!`;
//! recursion is bounded by the evaluator's depth cap (`#NUM!`) and the
//! step budget (`EvalError`), never a stack overflow.

use std::rc::Rc;

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::lambda::LambdaValue;
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    // Last arg is the calculation; the rest are parameter names.
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let mut params = Vec::with_capacity(args.len() - 1);
    for a in &args[..args.len() - 1] {
        let Expr::Name(n) = a else {
            return Ok(Value::Error(CalcError::Name));
        };
        let n = n.to_ascii_lowercase();
        if params.contains(&n) {
            // Duplicate parameter name.
            return Ok(Value::Error(CalcError::Value));
        }
        params.push(n);
    }
    Ok(Value::Lambda(Rc::new(LambdaValue {
        params,
        body: args[args.len() - 1].clone(),
        env: ctx.capture_env(),
    })))
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
    fn immediate_invoke() {
        assert_eq!(n(&eval("=LAMBDA(x,x+1)(5)")), 6.0);
    }

    #[test]
    fn multi_param_invoke() {
        assert_eq!(n(&eval("=LAMBDA(a,b,a*10+b)(3,4)")), 34.0);
    }

    #[test]
    fn uncalled_lambda_is_calc_error() {
        // A lambda reaching the cell boundary cannot display -> #CALC!.
        assert_eq!(e(&eval("=LAMBDA(x,x+1)")), CalcError::Calc);
    }

    #[test]
    fn closure_captures_let_scope() {
        assert_eq!(n(&eval("=LET(a,10,LAMBDA(x,x+a))(5)")), 15.0);
    }

    #[test]
    fn bound_name_call() {
        assert_eq!(n(&eval("=LET(f,LAMBDA(x,x*2),f(21))")), 42.0);
    }

    #[test]
    fn recursion_via_let() {
        // Self-reference resolves through the enclosing LET scope.
        assert_eq!(
            n(&eval("=LET(fact,LAMBDA(n,IF(n<=1,1,n*fact(n-1))),fact(5))")),
            120.0
        );
    }

    #[test]
    fn recursion_depth_bounded() {
        // Deep recursion must return a defined error, never crash.
        // Depth cap produces #NUM! rather than EvalError::DepthExceeded.
        assert_eq!(
            e(&eval("=LET(f,LAMBDA(n,IF(n=0,0,1+f(n-1))),f(1000))")),
            CalcError::Num
        );
    }

    #[test]
    fn arity_mismatch_value_error() {
        assert_eq!(e(&eval("=LAMBDA(x,x+1)(1,2)")), CalcError::Value);
        assert_eq!(e(&eval("=LET(f,LAMBDA(x,y,x+y),f(1))")), CalcError::Value);
    }

    #[test]
    fn invalid_param_name() {
        assert_eq!(e(&eval("=LAMBDA(A1,x+1)(5)")), CalcError::Name);
        assert_eq!(e(&eval("=LAMBDA(1,x+1)(5)")), CalcError::Name);
    }

    #[test]
    fn duplicate_param_name() {
        assert_eq!(e(&eval("=LAMBDA(x,x,x+1)(5,6)")), CalcError::Value);
    }

    #[test]
    fn param_shadows_let_binding() {
        assert_eq!(n(&eval("=LET(x,100,LAMBDA(x,x+1)(1))")), 2.0);
    }

    #[test]
    fn lambda_in_scalar_coercion_errors() {
        // Lambdas do not coerce to numbers.
        assert_eq!(e(&eval("=LET(f,LAMBDA(x,x),f+1)")), CalcError::Value);
    }

    #[test]
    fn zero_param_lambda() {
        assert_eq!(n(&eval("=LAMBDA(42)()")), 42.0);
    }

    #[test]
    fn lambda_returning_lambda() {
        // Curried form: outer invoke returns a lambda, invoked again.
        assert_eq!(n(&eval("=LAMBDA(x,LAMBDA(y,x+y))(3)(4)")), 7.0);
    }
}
