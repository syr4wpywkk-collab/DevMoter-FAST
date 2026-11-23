//! `REGEXTEST(text, pattern, [case_sensitivity])` — `TRUE` when
//! `pattern` matches anywhere in `text` (substring semantics).
//! Spec: `docs/functions/REGEXTEST.md`.
//!
//! Regex dialect and error identities: see `common/regexes.rs`
//! (SPEC-OPEN items recorded there). Array `text` maps element-wise and
//! spills booleans.

use crate::common::{coercion, regexes};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let pattern = match coercion::eval_text(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let sensitivity = match coercion::eval_opt_number(ctx, args.get(2), 0.0)? {
        Ok(n) if n.is_finite() => n.trunc() as i64,
        Ok(_) => return Ok(Value::Error(CalcError::Value)),
        Err(e) => return Ok(Value::Error(e)),
    };
    let re = match regexes::compile(&pattern, sensitivity) {
        Ok(r) => r,
        Err(e) => return Ok(Value::Error(e)),
    };
    match coercion::map_text(ctx, &args[0], |s| Ok(Value::Boolean(re.is_match(s))))? {
        Ok(v) => Ok(v),
        Err(e) => Ok(Value::Error(e)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn b(v: &Value) -> bool {
        match v {
            Value::Boolean(b) => *b,
            o => panic!("expected boolean, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn match_anywhere() {
        assert!(b(&eval(r#"=REGEXTEST("Order 1234","\d+")"#)));
        assert!(b(&eval(r#"=REGEXTEST("abc","b")"#)));
    }

    #[test]
    fn no_match_false() {
        assert!(!b(&eval(r#"=REGEXTEST("Order","\d+")"#)));
    }

    #[test]
    fn anchors_full_match() {
        assert!(!b(&eval(r#"=REGEXTEST("ABC","^abc$")"#)));
        assert!(b(&eval(r#"=REGEXTEST("ABC","^abc$",1)"#)));
    }

    #[test]
    fn case_sensitivity() {
        assert!(!b(&eval(r#"=REGEXTEST("ABC","abc")"#)));
        assert!(b(&eval(r#"=REGEXTEST("ABC","abc",1)"#)));
    }

    #[test]
    fn invalid_regex_is_error() {
        assert_eq!(e(&eval(r#"=REGEXTEST("x","[")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=REGEXTEST("x","(")"#)), CalcError::Value);
    }

    #[test]
    fn invalid_sensitivity_is_error() {
        assert_eq!(e(&eval(r#"=REGEXTEST("x","a",2)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=REGEXTEST("x","a",-1)"#)), CalcError::Value);
    }

    #[test]
    fn classes_and_quantifiers() {
        assert!(b(&eval(r#"=REGEXTEST("2024-01-15","\d{4}-\d{2}-\d{2}")"#)));
        assert!(b(&eval(r#"=REGEXTEST("hello","h.llo")"#)));
        assert!(b(&eval(r#"=REGEXTEST("abc123","\w+\d+")"#)));
    }

    #[test]
    fn array_maps_elementwise() {
        let v = eval_with(
            &[
                ("A1", Value::Text("a1".into())),
                ("A2", Value::Text("bc".into())),
            ],
            r#"=REGEXTEST(A1:A2,"\d")"#,
        );
        match v {
            Value::Array(a) => {
                assert_eq!(a.get(0, 0), Some(&Value::Boolean(true)));
                assert_eq!(a.get(1, 0), Some(&Value::Boolean(false)));
            }
            o => panic!("expected array, got {o:?}"),
        }
    }

    #[test]
    fn number_coerces_to_text() {
        assert!(b(&eval(r#"=REGEXTEST(12345,"\d")"#)));
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=REGEXTEST(1/0,"a")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=REGEXTEST("a",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=REGEXTEST("a")"#)), CalcError::Value);
    }
}
