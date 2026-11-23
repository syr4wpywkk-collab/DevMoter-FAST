//! `SEARCH(find_text, within_text, [start_num])` — like `FIND` but
//! case-insensitive and wildcard-aware. Spec: `docs/functions/SEARCH.md`.
//!
//! Wildcards: `?` matches one character, `*` any run (possibly empty);
//! `~?`, `~*`, `~~` escape them. Matching is anchored: the result is the
//! 1-based UTF-16-unit position of the first start index whose pattern
//! matches *some* substring beginning there. Case folding is Unicode
//! simple lowercase mapping (locale-aware folding, e.g. `ß`/`SS`, is a
//! spec doc open question).

use super::find::{byte_offset_at_start, start_offset};
use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Pc {
    Lit(char),
    Any,
    Star,
}

/// Compile `~`-escaped wildcard pattern.
fn compile(pattern: &str) -> Vec<Pc> {
    let mut out = Vec::new();
    let mut chars = pattern.chars();
    while let Some(c) = chars.next() {
        match c {
            '~' => match chars.next() {
                Some(n) => out.push(Pc::Lit(n)),
                None => out.push(Pc::Lit('~')),
            },
            '?' => out.push(Pc::Any),
            '*' => out.push(Pc::Star),
            c => out.push(Pc::Lit(c)),
        }
    }
    out
}

fn eq_ci(a: char, b: char) -> bool {
    a == b || a.to_lowercase().eq(b.to_lowercase())
}

/// Does `p` match a prefix of `s` (any length, anchored at `s[0]`)?
fn match_prefix(p: &[Pc], s: &[char]) -> bool {
    match p.split_first() {
        None => true,
        Some((&Pc::Star, rest)) => (0..=s.len()).any(|k| match_prefix(rest, &s[k..])),
        Some((&Pc::Any, rest)) => !s.is_empty() && match_prefix(rest, &s[1..]),
        Some((&Pc::Lit(c), rest)) => !s.is_empty() && eq_ci(s[0], c) && match_prefix(rest, &s[1..]),
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 3) {
        return Ok(Value::Error(e));
    }
    let find = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let within = match coercion::eval_text(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let start = if args.len() == 3 {
        match coercion::eval_number(ctx, &args[2])? {
            Ok(n) => n,
            Err(e) => return Ok(Value::Error(e)),
        }
    } else {
        1.0
    };
    let start0 = match start_offset(start, &within) {
        Ok(o) => o,
        Err(e) => return Ok(Value::Error(e)),
    };
    if find.is_empty() {
        return Ok(Value::Number((start0 + 1) as f64));
    }
    let pattern = compile(&find);
    let chars: Vec<char> = within.chars().collect();
    // Cumulative UTF-16-unit offset at each char boundary.
    let mut unit_of_char = Vec::with_capacity(chars.len() + 1);
    let mut acc = 0usize;
    unit_of_char.push(0usize);
    for c in &chars {
        acc += c.len_utf16();
        unit_of_char.push(acc);
    }
    let start_char = within[..byte_offset_at_start(&within, start0)]
        .chars()
        .count();
    for i in start_char..chars.len() {
        if match_prefix(&pattern, &chars[i..]) {
            return Ok(Value::Number((unit_of_char[i] + 1) as f64));
        }
    }
    Ok(Value::Error(CalcError::Value))
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
    fn case_insensitive() {
        // First 'e' in "Statements" is at 5 (spec doc example says 1 —
        // discrepancy flagged in the fixture set).
        assert_eq!(n(&eval(r#"=SEARCH("e","Statements")"#)), 5.0);
        assert_eq!(n(&eval(r#"=SEARCH("M","miriam")"#)), 1.0);
    }

    #[test]
    fn star_wildcard() {
        assert_eq!(n(&eval(r#"=SEARCH("b*n","banana")"#)), 1.0);
        assert_eq!(n(&eval(r#"=SEARCH("b*a","banana")"#)), 1.0);
    }

    #[test]
    fn question_wildcard() {
        assert_eq!(n(&eval(r#"=SEARCH("b?n","banana")"#)), 1.0);
        assert_eq!(e(&eval(r#"=SEARCH("b?a","banana")"#)), CalcError::Value);
    }

    #[test]
    fn tilde_escapes() {
        assert_eq!(n(&eval(r#"=SEARCH("~?","a?b")"#)), 2.0);
        assert_eq!(n(&eval(r#"=SEARCH("~*","a*b")"#)), 2.0);
        assert_eq!(n(&eval(r#"=SEARCH("~~","a~b")"#)), 2.0);
    }

    #[test]
    fn no_match_is_value_error() {
        assert_eq!(e(&eval(r#"=SEARCH("zzz","abc")"#)), CalcError::Value);
    }

    #[test]
    fn start_num() {
        assert_eq!(n(&eval(r#"=SEARCH("a","banana",4)"#)), 4.0);
        assert_eq!(e(&eval(r#"=SEARCH("a","banana",7)"#)), CalcError::Value);
    }

    #[test]
    fn empty_find_returns_start() {
        assert_eq!(n(&eval(r#"=SEARCH("","abc",2)"#)), 2.0);
    }

    #[test]
    fn case_folds_unicode() {
        assert_eq!(n(&eval(r#"=SEARCH("É","café")"#)), 4.0);
    }

    #[test]
    fn non_bmp_position_counts_units() {
        assert_eq!(n(&eval(r#"=SEARCH("x","😀x")"#)), 3.0);
    }

    #[test]
    fn numbers_coerce() {
        assert_eq!(n(&eval("=SEARCH(3,12345)")), 3.0);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=SEARCH(1/0,"abc")"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=SEARCH("a")"#)), CalcError::Value);
    }
}
