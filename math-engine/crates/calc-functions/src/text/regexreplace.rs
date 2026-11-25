//! `REGEXREPLACE(text, pattern, replacement, [occurrence],
//! [case_sensitivity])` — replaces regex matches in `text`.
//! Spec: `docs/functions/REGEXREPLACE.md`.
//!
//! `occurrence = 0` (default) replaces all non-overlapping matches;
//! `n > 0` replaces only the n-th match (fewer than n matches returns
//! `text` unchanged). No match returns `text` unchanged — *not* `#N/A`.
//! Replacement templates expand `$1`..`$99`, `${name}`, `$0`/`$&` and
//! `$$` via `common/regexes.rs` (JavaScript conventions; dialect gaps
//! recorded there).

use crate::common::{coercion, regexes};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

fn replace(re: &regex::Regex, text: &str, template: &str, occurrence: i64) -> String {
    if occurrence == 0 {
        return re
            .replace_all(text, |caps: &regex::Captures<'_>| {
                regexes::expand(template, caps)
            })
            .into_owned();
    }
    match re.captures_iter(text).nth(occurrence as usize - 1) {
        None => text.to_string(),
        Some(caps) => {
            let m = caps.get(0).unwrap();
            let mut out = String::with_capacity(text.len() + template.len());
            out.push_str(&text[..m.start()]);
            out.push_str(&regexes::expand(template, &caps));
            out.push_str(&text[m.end()..]);
            out
        }
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 5) {
        return Ok(Value::Error(e));
    }
    let pattern = match coercion::eval_text(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let template = match coercion::eval_text(ctx, &args[2])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let occurrence = match coercion::eval_opt_number(ctx, args.get(3), 0.0)? {
        Ok(n) if n.is_finite() && n.trunc() >= 0.0 => n.trunc() as i64,
        Ok(_) => return Ok(Value::Error(CalcError::Value)),
        Err(e) => return Ok(Value::Error(e)),
    };
    let sensitivity = match coercion::eval_opt_number(ctx, args.get(4), 0.0)? {
        Ok(n) if n.is_finite() => n.trunc() as i64,
        Ok(_) => return Ok(Value::Error(CalcError::Value)),
        Err(e) => return Ok(Value::Error(e)),
    };
    let re = match regexes::compile(&pattern, sensitivity) {
        Ok(r) => r,
        Err(e) => return Ok(Value::Error(e)),
    };
    match coercion::map_text(ctx, &args[0], |s| {
        Ok(Value::Text(replace(&re, s, &template, occurrence)))
    })? {
        Ok(v) => Ok(v),
        Err(e) => Ok(Value::Error(e)),
    }
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
    fn replace_all() {
        assert_eq!(t(&eval(r##"=REGEXREPLACE("a1b2","\d","#")"##)), "a#b#");
    }

    #[test]
    fn nth_occurrence() {
        assert_eq!(t(&eval(r##"=REGEXREPLACE("a1b2","\d","#",2)"##)), "a1b#");
        assert_eq!(t(&eval(r##"=REGEXREPLACE("a1b2","\d","#",1)"##)), "a#b2");
    }

    #[test]
    fn occurrence_beyond_matches_unchanged() {
        assert_eq!(t(&eval(r##"=REGEXREPLACE("a1b2","\d","#",3)"##)), "a1b2");
    }

    #[test]
    fn backreferences() {
        assert_eq!(
            t(&eval(
                r##"=REGEXREPLACE("2024-01-15","(\d+)-(\d+)-(\d+)","$3/$2/$1")"##
            )),
            "15/01/2024"
        );
    }

    #[test]
    fn case_sensitivity() {
        assert_eq!(t(&eval(r##"=REGEXREPLACE("ABC","abc","x",0,1)"##)), "x");
        assert_eq!(t(&eval(r##"=REGEXREPLACE("ABC","abc","x")"##)), "ABC");
    }

    #[test]
    fn no_match_returns_input() {
        assert_eq!(t(&eval(r##"=REGEXREPLACE("abc","z","#")"##)), "abc");
    }

    #[test]
    fn dollar_escapes() {
        assert_eq!(t(&eval(r##"=REGEXREPLACE("a1","\d","$$")"##)), "a$");
        assert_eq!(t(&eval(r##"=REGEXREPLACE("a1","\d","$&x")"##)), "a1x");
    }

    #[test]
    fn negative_occurrence_is_error() {
        assert_eq!(
            e(&eval(r##"=REGEXREPLACE("a1","\d","#",-1)"##)),
            CalcError::Value
        );
        assert_eq!(
            e(&eval(r##"=REGEXREPLACE("a1","\d","#",0,2)"##)),
            CalcError::Value
        );
    }

    #[test]
    fn invalid_regex_is_error() {
        assert_eq!(
            e(&eval(r##"=REGEXREPLACE("x","[","y")"##)),
            CalcError::Value
        );
    }

    #[test]
    fn array_maps_elementwise() {
        let v = eval_with(
            &[
                ("A1", Value::Text("a1".into())),
                ("A2", Value::Text("b2".into())),
            ],
            r##"=REGEXREPLACE(A1:A2,"\d","#")"##,
        );
        match v {
            Value::Array(a) => {
                assert_eq!(a.get(0, 0), Some(&Value::Text("a#".into())));
                assert_eq!(a.get(1, 0), Some(&Value::Text("b#".into())));
            }
            o => panic!("expected array, got {o:?}"),
        }
    }

    #[test]
    fn error_propagates() {
        assert_eq!(
            e(&eval(r##"=REGEXREPLACE(1/0,"a","b")"##)),
            CalcError::DivZero
        );
        assert_eq!(
            e(&eval(r##"=REGEXREPLACE("a",1/0,"b")"##)),
            CalcError::DivZero
        );
        assert_eq!(
            e(&eval(r##"=REGEXREPLACE("a","b",1/0)"##)),
            CalcError::DivZero
        );
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r##"=REGEXREPLACE("a","b")"##)), CalcError::Value);
    }
}
