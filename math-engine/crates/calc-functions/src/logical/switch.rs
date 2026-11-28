//! `SWITCH(expression, value1, result1, ..., [default])` — first
//! candidate equal to `expression`; `default` when none matches.
//! Spec: `docs/functions/SWITCH.md`.
//!
//! Lazy like `IFS`/`IF`: only the matched `result` is evaluated;
//! candidates are evaluated left to right and evaluation stops at the
//! first match, so errors in unreached arguments never surface.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let target = ctx.eval(&args[0])?;
    if let Some(e) = target.error() {
        return Ok(Value::Error(e));
    }
    let rest = &args[1..];
    // `rest` is value/result pairs plus an optional trailing default:
    // odd -> last arg is the default; even -> dangling candidate.
    if rest.len() % 2 != 0 {
        // last element is the default
        let (pairs, default) = rest.split_at(rest.len() - 1);
        match match_pairs(ctx, &target, pairs)? {
            Some(v) => Ok(v),
            None => ctx.eval(&default[0]),
        }
    } else {
        match match_pairs(ctx, &target, rest)? {
            Some(v) => Ok(v),
            None => Ok(Value::Error(CalcError::NA)),
        }
    }
}

/// Evaluate candidates left to right; on the first [`scalar_eq`] match,
/// evaluate and return the paired result. Candidate errors before the
/// match propagate; pairs after the match are never touched.
fn match_pairs(
    ctx: &mut EvalContext<'_>,
    target: &Value,
    pairs: &[Expr],
) -> Result<Option<Value>, EvalError> {
    for pair in pairs.chunks_exact(2) {
        let cand = ctx.eval(&pair[0])?;
        if let Some(e) = cand.error() {
            return Ok(Some(Value::Error(e)));
        }
        if crate::common::compare::scalar_eq(target, &cand) {
            return ctx.eval(&pair[1]).map(Some);
        }
    }
    Ok(None)
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
    fn numeric_match() {
        let f = r#"=SWITCH(A1,1,"one",2,"two","other")"#;
        assert_eq!(t(&eval_with(&[("A1", 1.0.into())], f)), "one");
        assert_eq!(t(&eval_with(&[("A1", 2.0.into())], f)), "two");
        assert_eq!(t(&eval_with(&[("A1", 9.0.into())], f)), "other");
    }

    #[test]
    fn first_match_wins() {
        let f = r#"=SWITCH(2,2,"first",2,"second","none")"#;
        assert_eq!(t(&eval(f)), "first");
    }

    #[test]
    fn text_match_case_insensitive() {
        // SPEC-OPEN confirm: Excel comparisons are case-insensitive.
        let f = r#"=SWITCH("ABC","abc","hit","miss")"#;
        assert_eq!(t(&eval(f)), "hit");
    }

    #[test]
    fn boolean_idiom() {
        let f = r#"=SWITCH(TRUE,A1>10,"big","small")"#;
        assert_eq!(t(&eval_with(&[("A1", 20.0.into())], f)), "big");
        assert_eq!(t(&eval_with(&[("A1", 1.0.into())], f)), "small");
    }

    #[test]
    fn no_match_no_default_na() {
        assert_eq!(e(&eval(r#"=SWITCH(3,1,"a",2,"b")"#)), CalcError::NA);
    }

    #[test]
    fn lazy_unselected_result() {
        let f = r#"=SWITCH(1,1,"ok",2,1/0,"def")"#;
        assert_eq!(t(&eval(f)), "ok");
    }

    #[test]
    fn lazy_unreached_candidate() {
        // Candidates after the match are never evaluated.
        let f = r#"=SWITCH(1,1,"ok",1/0,"bad","def")"#;
        assert_eq!(t(&eval(f)), "ok");
    }

    #[test]
    fn candidate_error_before_match_propagates() {
        let f = r#"=SWITCH(9,1/0,"bad",9,"hit","def")"#;
        assert_eq!(e(&eval(f)), CalcError::DivZero);
    }

    #[test]
    fn expression_error_propagates() {
        assert_eq!(e(&eval(r#"=SWITCH(1/0,1,"a","d")"#)), CalcError::DivZero);
    }

    #[test]
    fn cross_type_no_match() {
        // "1" text does not equal 1 (no coercion).
        let f = r#"=SWITCH(1,"1","text","none")"#;
        assert_eq!(t(&eval(f)), "none");
    }

    #[test]
    fn default_used() {
        assert_eq!(t(&eval(r#"=SWITCH(7,1,"a",2,"b","def")"#)), "def");
    }

    #[test]
    fn blank_matches_blank() {
        // SPEC-OPEN: blank expression vs blank candidate.
        assert_eq!(
            t(&eval_with(&[], r#"=SWITCH(A1,A2,"blanks","x")"#)),
            "blanks"
        );
    }

    #[test]
    fn numbers_match_at_fifteen_digits() {
        assert_eq!(t(&eval(r#"=SWITCH(0.1+0.2,0.3,"hit","miss")"#)), "hit");
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=SWITCH(1,2)")), CalcError::Value);
    }
}
