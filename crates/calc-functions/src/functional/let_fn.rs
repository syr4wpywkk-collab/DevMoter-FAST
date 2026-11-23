//! `LET(name1, value1, [name2, value2], ..., result)` — lexical name
//! binding. Spec: `docs/functions/LET.md`.
//!
//! Special form: each `value` is evaluated left-to-right in the scope of
//! the preceding bindings only, then `result` runs with all bindings
//! visible. Names do not leak outside the call.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    // Odd arg count >= 3: alternating name/value pairs then the result.
    if let Err(e) = check_arity(args, 3, calc_core::registry::MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    if args.len() % 2 == 0 {
        return Ok(Value::Error(CalcError::Value));
    }
    ctx.push_scope();
    let result = eval_scoped(ctx, args);
    ctx.pop_scope();
    result
}

fn eval_scoped(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    let pairs_end = args.len() - 1;
    let mut i = 0;
    while i < pairs_end {
        let name = match &args[i] {
            Expr::Name(n) => n,
            // Cell refs, literals, calls etc. are not valid names.
            _ => return Ok(Value::Error(CalcError::Name)),
        };
        let value = ctx.eval(&args[i + 1])?;
        // Errors in a bound value propagate (eager evaluation of bindings;
        // Excel is lazy here — SPEC-OPEN, see spec doc open questions).
        if let Some(e) = value.error() {
            return Ok(Value::Error(e));
        }
        // Later bindings of the same name shadow earlier ones (Excel
        // rejects duplicates — SPEC-OPEN).
        ctx.bind_local(name, value);
        i += 2;
    }
    ctx.eval(&args[pairs_end])
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
    fn basic_binding() {
        assert_eq!(n(&eval("=LET(x,2,x^3)")), 8.0);
    }

    #[test]
    fn sequential_scope() {
        // Each value sees preceding bindings only.
        assert_eq!(n(&eval("=LET(x,1,y,x+1,y*2)")), 4.0);
    }

    #[test]
    fn shadowing_outer_name() {
        // Inner binding shadows the earlier one; the second x sees the
        // first. SPEC-OPEN: Excel rejects duplicate names outright.
        assert_eq!(n(&eval("=LET(x,1,x,x+1,x)")), 2.0);
    }

    #[test]
    fn nested_let() {
        assert_eq!(n(&eval("=LET(x,1,LET(y,2,x+y))")), 3.0);
        // Inner shadowing does not leak outward.
        assert_eq!(n(&eval("=LET(x,1,LET(x,5,x)+x)")), 6.0);
    }

    #[test]
    fn name_does_not_leak() {
        assert_eq!(e(&eval("=LET(x,5,1)+x")), CalcError::Name);
    }

    #[test]
    fn names_case_insensitive() {
        assert_eq!(n(&eval("=LET(MyVar,7,myvar+MYVAR)")), 14.0);
    }

    #[test]
    fn cellref_name_rejected() {
        assert_eq!(e(&eval("=LET(A1,2,A1)")), CalcError::Name);
    }

    #[test]
    fn literal_name_rejected() {
        assert_eq!(e(&eval("=LET(5,2,1)")), CalcError::Name);
    }

    #[test]
    fn even_arity_error() {
        assert_eq!(e(&eval("=LET(x,1,y,2)")), CalcError::Value);
        assert_eq!(e(&eval("=LET(x)")), CalcError::Value);
    }

    #[test]
    fn bound_value_error_propagates() {
        // Eager binding evaluation. SPEC-OPEN: Excel's lazy LET returns 5.
        assert_eq!(e(&eval("=LET(x,1/0,5)")), CalcError::DivZero);
    }

    #[test]
    fn result_error_propagates() {
        assert_eq!(e(&eval("=LET(x,1,x/0)")), CalcError::DivZero);
    }

    #[test]
    fn references_and_ranges_bind() {
        let v = eval_with(&[("A1", 3.0.into())], "=LET(v,A1*2,v+1)");
        assert_eq!(n(&v), 7.0);
    }

    #[test]
    fn binding_used_in_later_call() {
        assert_eq!(n(&eval("=LET(b,10,SUM(b,5))")), 15.0);
    }

    #[test]
    fn text_and_bool_values() {
        assert_eq!(eval(r#"=LET(s,"hi",s&"!")"#), Value::Text("hi!".into()));
        assert_eq!(eval("=LET(f,TRUE,IF(f,1,2))"), Value::Number(1.0));
    }
}
