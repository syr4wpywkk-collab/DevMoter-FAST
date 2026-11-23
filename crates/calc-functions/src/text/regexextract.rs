//! `REGEXEXTRACT(text, pattern, [return_mode], [case_sensitivity])` —
//! extracts regex matches. Spec: `docs/functions/REGEXEXTRACT.md`.
//!
//! `return_mode`: `0` first match (default), `1` all matches spilled as
//! a 1xN array, `2` capture groups of the first match spilled as a 1xG
//! array (a group-less pattern yields the whole match). No match is
//! `#N/A` in every mode. Regex dialect and error identities: see
//! `common/regexes.rs`.
//!
//! Array `text` maps element-wise in mode 0 (the only mode whose
//! per-element result is scalar); modes 1/2 on an array are `#VALUE!`
//! — Excel's spill layout for nested arrays is a spec-doc open
//! question.

use crate::common::{coercion, regexes};
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

fn extract(re: &regex::Regex, text: &str, mode: i64) -> Result<Value, CalcError> {
    match mode {
        0 => re
            .find(text)
            .map(|m| Value::Text(m.as_str().to_string()))
            .ok_or(CalcError::NA),
        1 => {
            let cells: Vec<Value> = re
                .find_iter(text)
                .map(|m| Value::Text(m.as_str().to_string()))
                .collect();
            if cells.is_empty() {
                return Err(CalcError::NA);
            }
            ArrayValue::from_row(cells).map(Value::Array)
        }
        2 => match re.captures(text) {
            None => Err(CalcError::NA),
            Some(caps) => {
                let cells: Vec<Value> = if caps.len() <= 1 {
                    vec![Value::Text(caps[0].to_string())]
                } else {
                    (1..caps.len())
                        .map(|i| {
                            Value::Text(
                                caps.get(i)
                                    .map(|m| m.as_str().to_string())
                                    .unwrap_or_default(),
                            )
                        })
                        .collect()
                };
                ArrayValue::from_row(cells).map(Value::Array)
            }
        },
        _ => Err(CalcError::Value),
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 4) {
        return Ok(Value::Error(e));
    }
    let pattern = match coercion::eval_text(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let mode = match coercion::eval_opt_number(ctx, args.get(2), 0.0)? {
        Ok(n) if n.is_finite() => n.trunc() as i64,
        Ok(_) => return Ok(Value::Error(CalcError::Value)),
        Err(e) => return Ok(Value::Error(e)),
    };
    let sensitivity = match coercion::eval_opt_number(ctx, args.get(3), 0.0)? {
        Ok(n) if n.is_finite() => n.trunc() as i64,
        Ok(_) => return Ok(Value::Error(CalcError::Value)),
        Err(e) => return Ok(Value::Error(e)),
    };
    let re = match regexes::compile(&pattern, sensitivity) {
        Ok(r) => r,
        Err(e) => return Ok(Value::Error(e)),
    };
    match mode {
        0 => match coercion::map_text(ctx, &args[0], |s| extract(&re, s, 0))? {
            Ok(v) => Ok(v),
            Err(e) => Ok(Value::Error(e)),
        },
        _ => match coercion::eval_text(ctx, &args[0])? {
            Ok(s) => Ok(match extract(&re, &s, mode) {
                Ok(v) => v,
                Err(e) => Value::Error(e),
            }),
            Err(e) => Ok(Value::Error(e)),
        },
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

    fn cells(v: &Value) -> Vec<String> {
        match v {
            Value::Array(a) => a
                .cells()
                .iter()
                .map(|c| match c {
                    Value::Text(s) => s.clone(),
                    o => panic!("non-text cell {o:?}"),
                })
                .collect(),
            o => panic!("expected array, got {o:?}"),
        }
    }

    #[test]
    fn first_match() {
        assert_eq!(t(&eval(r#"=REGEXEXTRACT("Order 1234","\d+")"#)), "1234");
    }

    #[test]
    fn all_matches_row() {
        let v = eval(r#"=REGEXEXTRACT("a1b2c3","\d",1)"#);
        if let Value::Array(a) = &v {
            assert_eq!((a.rows(), a.cols()), (1, 3));
        }
        assert_eq!(cells(&v), ["1", "2", "3"]);
    }

    #[test]
    fn capture_groups() {
        assert_eq!(
            cells(&eval(
                r#"=REGEXEXTRACT("2024-01-15","(\d+)-(\d+)-(\d+)",2)"#
            )),
            ["2024", "01", "15"]
        );
    }

    #[test]
    fn groupless_mode2_is_whole_match() {
        assert_eq!(cells(&eval(r#"=REGEXEXTRACT("ab12cd","\d+",2)"#)), ["12"]);
    }

    #[test]
    fn unmatched_optional_group_is_empty() {
        assert_eq!(
            cells(&eval(r#"=REGEXEXTRACT("ab","(a)(x)?",2)"#)),
            ["a", ""]
        );
    }

    #[test]
    fn no_match_is_na() {
        assert_eq!(e(&eval(r#"=REGEXEXTRACT("ABC","\d")"#)), CalcError::NA);
        assert_eq!(e(&eval(r#"=REGEXEXTRACT("ABC","\d",1)"#)), CalcError::NA);
        assert_eq!(e(&eval(r#"=REGEXEXTRACT("ABC","\d",2)"#)), CalcError::NA);
    }

    #[test]
    fn case_sensitivity() {
        assert_eq!(e(&eval(r#"=REGEXEXTRACT("ABC","abc")"#)), CalcError::NA);
        assert_eq!(t(&eval(r#"=REGEXEXTRACT("ABC","abc",0,1)"#)), "ABC");
    }

    #[test]
    fn invalid_regex_is_error() {
        assert_eq!(e(&eval(r#"=REGEXEXTRACT("x","[")"#)), CalcError::Value);
    }

    #[test]
    fn invalid_mode_is_error() {
        assert_eq!(e(&eval(r#"=REGEXEXTRACT("x","a",3)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=REGEXEXTRACT("x","a",-1)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=REGEXEXTRACT("x","a",0,2)"#)), CalcError::Value);
    }

    #[test]
    fn array_input_maps_mode0() {
        let v = eval_with(
            &[
                ("A1", Value::Text("a1".into())),
                ("A2", Value::Text("b2".into())),
            ],
            r#"=REGEXEXTRACT(A1:A2,"\d")"#,
        );
        match v {
            Value::Array(a) => {
                assert_eq!(a.get(0, 0), Some(&Value::Text("1".into())));
                assert_eq!(a.get(1, 0), Some(&Value::Text("2".into())));
            }
            o => panic!("expected array, got {o:?}"),
        }
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=REGEXEXTRACT(1/0,"a")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=REGEXEXTRACT("a",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=REGEXEXTRACT("x")"#)), CalcError::Value);
    }
}
