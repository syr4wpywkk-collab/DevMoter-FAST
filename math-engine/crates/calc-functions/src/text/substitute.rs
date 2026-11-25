//! `SUBSTITUTE(text, old_text, new_text, [instance_num])` — replaces
//! occurrences of `old_text` with `new_text`.
//! Spec: `docs/functions/SUBSTITUTE.md`.
//!
//! Case-sensitive, no wildcards, non-overlapping left-to-right scan.
//! Without `instance_num` every occurrence is replaced; with it, only
//! that 1-based occurrence is. `instance_num` < 1 is `#VALUE!`; a value
//! beyond the occurrence count leaves `text` unchanged. Empty
//! `old_text` returns `text` unchanged.

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 4) {
        return Ok(Value::Error(e));
    }
    let mut vals = Vec::with_capacity(3);
    for arg in &args[..3] {
        match coercion::eval_text(ctx, arg)? {
            Ok(s) => vals.push(s),
            Err(e) => return Ok(Value::Error(e)),
        }
    }
    let (text, old, new) = (vals[0].as_str(), vals[1].as_str(), vals[2].as_str());
    let instance = if args.len() == 4 {
        match coercion::eval_number(ctx, &args[3])? {
            Ok(n) => {
                if !n.is_finite() || n < 1.0 {
                    return Ok(Value::Error(CalcError::Value));
                }
                Some(n.trunc().min(usize::MAX as f64) as usize)
            }
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        None
    };
    Ok(Value::Text(substitute(text, old, new, instance)))
}

fn substitute(text: &str, old: &str, new: &str, instance: Option<usize>) -> String {
    if old.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let mut seen = 0usize;
    while let Some(i) = rest.find(old) {
        seen += 1;
        if let Some(k) = instance {
            if seen != k {
                out.push_str(&rest[..i + old.len()]);
                rest = &rest[i + old.len()..];
                continue;
            }
        }
        out.push_str(&rest[..i]);
        out.push_str(new);
        rest = &rest[i + old.len()..];
        if instance.is_some() {
            break;
        }
    }
    out.push_str(rest);
    out
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
    fn replaces_all() {
        assert_eq!(t(&eval(r#"=SUBSTITUTE("aabaa","a","x")"#)), "xxbxx");
    }

    #[test]
    fn instance_selects_one() {
        assert_eq!(
            t(&eval(r#"=SUBSTITUTE("Quarter 1, 2008","1","2",1)"#)),
            "Quarter 2, 2008"
        );
        assert_eq!(t(&eval(r#"=SUBSTITUTE("a a a","a","b",2)"#)), "a b a");
    }

    #[test]
    fn instance_beyond_count_unchanged() {
        assert_eq!(t(&eval(r#"=SUBSTITUTE("abc","a","x",5)"#)), "abc");
    }

    #[test]
    fn instance_zero_is_value_error() {
        assert_eq!(
            e(&eval(r#"=SUBSTITUTE("abc","a","x",0)"#)),
            CalcError::Value
        );
        assert_eq!(
            e(&eval(r#"=SUBSTITUTE("abc","a","x",-1)"#)),
            CalcError::Value
        );
    }

    #[test]
    fn case_sensitive() {
        assert_eq!(t(&eval(r#"=SUBSTITUTE("AaA","a","x")"#)), "AxA");
    }

    #[test]
    fn empty_old_unchanged() {
        assert_eq!(t(&eval(r#"=SUBSTITUTE("abc","","x")"#)), "abc");
    }

    #[test]
    fn empty_new_deletes() {
        assert_eq!(t(&eval(r#"=SUBSTITUTE("a-b-c","-","")"#)), "abc");
    }

    #[test]
    fn non_overlapping_scan() {
        assert_eq!(t(&eval(r#"=SUBSTITUTE("aaa","aa","b")"#)), "ba");
    }

    #[test]
    fn old_equals_new_unchanged() {
        assert_eq!(t(&eval(r#"=SUBSTITUTE("abc","b","b")"#)), "abc");
    }

    #[test]
    fn numbers_coerce() {
        assert_eq!(t(&eval("=SUBSTITUTE(1234,2,9)")), "1934");
    }

    #[test]
    fn no_occurrence_unchanged() {
        assert_eq!(t(&eval(r#"=SUBSTITUTE("abc","z","x")"#)), "abc");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=SUBSTITUTE(1/0,"a","b")"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=SUBSTITUTE("a","b")"#)), CalcError::Value);
    }
}
