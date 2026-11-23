//! `TEXTAFTER(text, delimiter, [instance_num], [match_mode],
//! [match_end], [if_not_found])` — text after the chosen delimiter
//! instance. Spec: `docs/functions/TEXTAFTER.md`.
//!
//! Mirror of `TEXTBEFORE` (see `textbefore.rs` for the shared instance
//! resolver). `match_end = 1` adds a virtual delimiter at the end of the
//! text for positive instances (`TEXTAFTER(t,d,1,0,1)` -> `""` when `d`
//! is absent) and at the start for negative ones (`-1` -> the whole
//! text). Empty delimiter "matches immediately" (Microsoft's documented
//! rule; SPEC-OPEN in the spec doc).

use super::textbefore;
use calc_core::ast::Expr;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    textbefore::split_at_impl(ctx, args, false)
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn t(v: &Value) -> &str {
        match v {
            Value::Text(s) => s,
            o => panic!("expected text, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn basic() {
        assert_eq!(t(&eval(r#"=TEXTAFTER("Red fox jumps"," ")"#)), "fox jumps");
        assert_eq!(t(&eval(r#"=TEXTAFTER("abc","b")"#)), "c");
    }

    #[test]
    fn second_instance() {
        assert_eq!(t(&eval(r#"=TEXTAFTER("a-b-c","-",2)"#)), "c");
    }

    #[test]
    fn negative_instance_from_right() {
        assert_eq!(t(&eval(r#"=TEXTAFTER("a-b-c","-",-1)"#)), "c");
        assert_eq!(t(&eval(r#"=TEXTAFTER("a-b-c","-",-2)"#)), "b-c");
    }

    #[test]
    fn case_sensitivity() {
        assert_eq!(e(&eval(r#"=TEXTAFTER("ABC","abc")"#)), CalcError::NA);
        assert_eq!(t(&eval(r#"=TEXTAFTER("ABC","abc",1,1)"#)), "");
    }

    #[test]
    fn not_found() {
        assert_eq!(e(&eval(r#"=TEXTAFTER("abc","z")"#)), CalcError::NA);
        assert_eq!(t(&eval(r#"=TEXTAFTER("abc","z",1,0,0,"none")"#)), "none");
    }

    #[test]
    fn match_end() {
        // Delimiter absent + positive instance: end is the delimiter ->
        // nothing after it.
        assert_eq!(t(&eval(r#"=TEXTAFTER("abc","z",1,0,1)"#)), "");
        // Spec doc example: negative instance finds the virtual start
        // delimiter -> whole text after it.
        assert_eq!(t(&eval(r#"=TEXTAFTER("abc","z",-1,0,1)"#)), "abc");
        // Second "-" instance in "a-b" is the virtual end delimiter.
        assert_eq!(t(&eval(r#"=TEXTAFTER("a-b","-",2,0,1)"#)), "");
    }

    #[test]
    fn invalid_instance() {
        assert_eq!(e(&eval(r#"=TEXTAFTER("a-b","-",0)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=TEXTAFTER("a-b","-",9)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=TEXTAFTER("a-b","-",1,2)"#)), CalcError::Value);
    }

    #[test]
    fn empty_delimiter_matches_immediately() {
        assert_eq!(t(&eval(r#"=TEXTAFTER("abc","")"#)), "abc");
        assert_eq!(t(&eval(r#"=TEXTAFTER("abc","",-1)"#)), "");
    }

    #[test]
    fn multichar_delimiter() {
        assert_eq!(t(&eval(r#"=TEXTAFTER("a<->b<->c","<->")"#)), "b<->c");
    }

    #[test]
    fn delimiter_at_end_gives_empty() {
        assert_eq!(t(&eval(r#"=TEXTAFTER("abc","c")"#)), "");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=TEXTAFTER(1/0,"x")"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=TEXTAFTER("x")"#)), CalcError::Value);
    }
}
