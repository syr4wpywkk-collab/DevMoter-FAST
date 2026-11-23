//! `EXACT(text1, text2)` — `TRUE` if two text values are exactly
//! equal, compared case-sensitively. Spec: `docs/functions/EXACT.md`.
//!
//! Both arguments coerce to text before comparison, so types never
//! compare directly (`EXACT(1,"1")` -> `TRUE`). Comparison is a raw
//! code-unit sequence: no Unicode normalization and no case folding
//! beyond what the text coercion already did (SPEC-OPEN notes in the
//! spec doc).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let a = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let b = match coercion::eval_text(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    Ok(Value::Boolean(a == b))
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
    fn equal() {
        assert!(b(&eval(r#"=EXACT("word","word")"#)));
    }

    #[test]
    fn case_sensitive() {
        assert!(!b(&eval(r#"=EXACT("Word","word")"#)));
    }

    #[test]
    fn spaces_count() {
        assert!(!b(&eval(r#"=EXACT(" a","a")"#)));
        assert!(!b(&eval(r#"=EXACT("a","a ")"#)));
    }

    #[test]
    fn number_coerces_to_text() {
        assert!(b(&eval(r#"=EXACT(12,"12")"#)));
        assert!(!b(&eval(r#"=EXACT(1.5,"1.50")"#)));
    }

    #[test]
    fn boolean_coerces() {
        assert!(b(&eval(r#"=EXACT(TRUE,"TRUE")"#)));
        assert!(b(&eval("=EXACT(TRUE,TRUE)")));
    }

    #[test]
    fn blank_vs_empty_string() {
        assert!(b(&eval(r#"=EXACT(A1,"")"#)));
    }

    #[test]
    fn accented_case_sensitive() {
        assert!(!b(&eval(r#"=EXACT("É","é")"#)));
    }

    #[test]
    fn composed_vs_decomposed_differs() {
        // No Unicode normalization: é vs e + combining accent.
        assert!(!b(&eval(r#"=EXACT("é","é")"#)));
    }

    #[test]
    fn empty_vs_empty() {
        assert!(b(&eval(r#"=EXACT("","")"#)));
    }

    #[test]
    fn first_error_propagates() {
        assert_eq!(e(&eval(r#"=EXACT(1/0,"x")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=EXACT("x",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=EXACT("a")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=EXACT("a","b","c")"#)), CalcError::Value);
    }
}
