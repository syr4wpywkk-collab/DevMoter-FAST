//! `ISOMITTED(argument)` — TRUE when an optional parameter of the
//! enclosing `LAMBDA` was omitted by the caller. Spec:
//! `docs/functions/ISOMITTED.md`.
//!
//! Engine limitation: `LAMBDA` has no `[param]` optional-parameter
//! syntax and `call_lambda` requires exact arity, so a parameter can
//! only be "omitted" via an explicitly empty argument slot
//! (`LAMBDA(x,y,...)(5,)` binds `y` to `Blank`). `ISOMITTED(name)`
//! therefore reports whether `name` is bound to `Blank` in the current
//! scope — an approximation pending optional lambda parameters
//! (SPEC-OPEN).
//!
//! The argument must be a bare name (`Expr::Name`): a bound name is
//! inspected, an unbound name is `#NAME?`, and a non-name expression
//! is `#VALUE!`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let Expr::Name(name) = &args[0] else {
        return Ok(Value::Error(CalcError::Value));
    };
    match ctx.lookup_local(&name.to_ascii_lowercase()) {
        Some(v) => Ok(Value::Boolean(v.is_blank())),
        None => Ok(Value::Error(CalcError::Name)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn b(v: &Value) -> bool {
        match v {
            Value::Boolean(b) => *b,
            o => panic!("expected bool, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn supplied_param_false() {
        assert!(!b(&eval("=LAMBDA(x,y,ISOMITTED(y))(5,10)")));
    }

    #[test]
    fn empty_slot_param_true() {
        // `y` omitted via an explicit empty argument slot.
        assert!(b(&eval("=LAMBDA(x,y,ISOMITTED(y))(5,)")));
    }

    #[test]
    fn bound_nonblank_false() {
        assert!(!b(&eval("=LAMBDA(x,ISOMITTED(x))(0)")));
        assert!(!b(&eval("=LAMBDA(x,ISOMITTED(x))(FALSE)")));
        assert!(!b(&eval("=LAMBDA(x,ISOMITTED(x))(NA())")));
    }

    #[test]
    fn if_isomitted_pattern() {
        assert_eq!(
            eval("=LAMBDA(x,y,IF(ISOMITTED(y),x,x+y))(3,)"),
            Value::Number(3.0)
        );
        assert_eq!(
            eval("=LAMBDA(x,y,IF(ISOMITTED(y),x,x+y))(3,4)"),
            Value::Number(7.0)
        );
    }

    #[test]
    fn middle_slot_omitted() {
        assert!(b(&eval("=LAMBDA(a,b,c,ISOMITTED(b))(1,,3)")));
        assert!(!b(&eval("=LAMBDA(a,b,c,ISOMITTED(a))(1,,3)")));
        assert!(!b(&eval("=LAMBDA(a,b,c,ISOMITTED(c))(1,,3)")));
    }

    #[test]
    fn outside_lambda_unbound_name() {
        // SPEC-OPEN: exact error for ISOMITTED outside a LAMBDA;
        // an unbound name is `#NAME?`.
        assert_eq!(e(&eval("=ISOMITTED(y)")), CalcError::Name);
    }

    #[test]
    fn non_name_argument_value() {
        assert_eq!(e(&eval("=ISOMITTED(5)")), CalcError::Value);
        assert_eq!(e(&eval("=ISOMITTED(A1)")), CalcError::Value);
        assert_eq!(e(&eval(r#"=ISOMITTED("x")"#)), CalcError::Value);
    }

    #[test]
    fn let_bound_name_is_not_omitted() {
        // A LET binding supplies a value -> not omitted.
        assert!(!b(&eval("=LET(z,9,ISOMITTED(z))")));
    }

    #[test]
    fn case_insensitive_param_name() {
        assert!(!b(&eval("=LAMBDA(y,ISOMITTED(Y))(7)")));
    }

    #[test]
    fn nested_lambda_inner_scope() {
        // Inner lambda's omitted slot is what ISOMITTED sees.
        assert!(b(&eval("=LAMBDA(a,LAMBDA(b,c,ISOMITTED(c))(a,))(9)")));
        assert!(!b(&eval("=LAMBDA(a,LAMBDA(b,c,ISOMITTED(b))(a,))(9)")));
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ISOMITTED()")), CalcError::Value);
        assert_eq!(e(&eval("=ISOMITTED(x,y)")), CalcError::Value);
    }
}
