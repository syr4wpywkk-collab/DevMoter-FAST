//! `TEXTBEFORE(text, delimiter, [instance_num], [match_mode],
//! [match_end], [if_not_found])` — text before the chosen delimiter
//! instance. Spec: `docs/functions/TEXTBEFORE.md`.
//!
//! `instance_num` counts occurrences from the left (default 1); negative
//! counts from the right (`-1` = last). `0` or `|instance_num|` larger
//! than the text length is `#VALUE!` (per the Microsoft documentation
//! quoted in the spec); a valid-but-absent instance is `#N/A` or
//! `if_not_found`. `match_end = 1` adds a virtual delimiter at the
//! *end* of the text for positive instances and at the *start* for
//! negative ones, so `TEXTBEFORE(t,d,1,0,1)` returns `t` when `d` is
//! absent. An empty delimiter matches immediately: position 0 for
//! positive instances, end-of-text for negative (Microsoft's documented
//! "matches immediately" rule; recorded SPEC-OPEN in the spec doc).

use crate::common::coercion;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// `(text_start_byte, text_end_byte)` of one delimiter occurrence —
/// UTF-8 byte offsets into the searched text.
pub(crate) type Occurrence = (usize, usize);

/// Case-insensitive per-char comparison (Unicode simple lowercase,
/// same rule as `SEARCH`).
fn eq_ci(a: char, b: char) -> bool {
    a == b || a.to_lowercase().eq(b.to_lowercase())
}

/// All non-overlapping occurrences of `delim` in `text`, scanned left
/// to right at character granularity. Empty `delim` yields none —
/// callers model it as a virtual boundary match.
fn occurrences(text: &str, delim: &str, insensitive: bool) -> Vec<Occurrence> {
    if delim.is_empty() {
        return Vec::new();
    }
    let d: Vec<char> = delim.chars().collect();
    let t: Vec<(usize, char)> = text.char_indices().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i + d.len() <= t.len() {
        let hit = (0..d.len()).all(|k| {
            if insensitive {
                eq_ci(t[i + k].1, d[k])
            } else {
                t[i + k].1 == d[k]
            }
        });
        if hit {
            let start = t[i].0;
            let end = t.get(i + d.len()).map(|(b, _)| *b).unwrap_or(text.len());
            out.push((start, end));
            i += d.len();
        } else {
            i += 1;
        }
    }
    out
}

/// Resolve the `instance_num`-th delimiter occurrence into a byte
/// range. `Err(Value)` = invalid instance (`0` or `|n|` beyond the text
/// length); `Ok(None)` = valid instance with no such occurrence.
pub(crate) fn find_instance(
    text: &str,
    delim: &str,
    instance: i64,
    insensitive: bool,
    match_end: bool,
) -> Result<Option<Occurrence>, CalcError> {
    if instance == 0 || (instance.unsigned_abs() as usize) > text.chars().count() {
        return Err(CalcError::Value);
    }
    if delim.is_empty() {
        // "Matches immediately": at the start searching forward, at the
        // end searching backward (virtual occurrence is index 0/last).
        return Ok(Some(if instance > 0 {
            (0, 0)
        } else {
            (text.len(), text.len())
        }));
    }
    let mut occs = occurrences(text, delim, insensitive);
    let pick = if instance > 0 {
        if match_end {
            occs.push((text.len(), text.len()));
        }
        instance as usize - 1
    } else {
        if match_end {
            occs.insert(0, (0, 0));
        }
        // instance = -1 -> last element.
        let back = (-instance) as usize;
        if back > occs.len() {
            return Ok(None);
        }
        occs.len() - back
    };
    Ok(occs.get(pick).copied())
}

/// Shared optional-argument plumbing for `TEXTBEFORE`/`TEXTAFTER`:
/// returns `(instance, insensitive, match_end)` or an error `Value`.
#[allow(clippy::type_complexity)]
pub(crate) fn parse_options(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Result<Result<(i64, bool, bool), CalcError>, EvalError> {
    let instance = match coercion::eval_opt_number(ctx, args.get(2), 1.0)? {
        Ok(n) if n.is_finite() => n.trunc() as i64,
        Ok(_) => return Ok(Err(CalcError::Value)),
        Err(e) => return Ok(Err(e)),
    };
    let mut flag = |idx: usize| -> Result<Result<bool, CalcError>, EvalError> {
        match coercion::eval_opt_number(ctx, args.get(idx), 0.0)? {
            Ok(n) if n.is_finite() => match n.trunc() as i64 {
                0 => Ok(Ok(false)),
                1 => Ok(Ok(true)),
                _ => Ok(Err(CalcError::Value)),
            },
            Ok(_) => Ok(Err(CalcError::Value)),
            Err(e) => Ok(Err(e)),
        }
    };
    let insensitive = match flag(3)? {
        Ok(b) => b,
        Err(e) => return Ok(Err(e)),
    };
    let match_end = match flag(4)? {
        Ok(b) => b,
        Err(e) => return Ok(Err(e)),
    };
    Ok(Ok((instance, insensitive, match_end)))
}

/// `if_not_found` fallback: evaluates `args[5]` lazily (omitted or
/// `Missing` -> `#N/A`).
fn if_not_found(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    match args.get(5) {
        Some(Expr::Missing) | None => Ok(Value::Error(CalcError::NA)),
        Some(e) => Ok(ctx.eval(e)?),
    }
}

/// Core for both functions (`TEXTAFTER` delegates here): `before`
/// picks which side of the resolved occurrence to keep.
pub(crate) fn split_at_impl(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    before: bool,
) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 6) {
        return Ok(Value::Error(e));
    }
    let delim = match coercion::eval_text(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    let (instance, insensitive, match_end) = match parse_options(ctx, args)? {
        Ok(t) => t,
        Err(e) => return Ok(Value::Error(e)),
    };
    let text = match ctx.eval_arg(&args[0])?.into_value() {
        // Array input maps element-wise and spills (spec doc). The
        // `if_not_found` fallback is evaluated eagerly in this branch —
        // a scalar input keeps it lazy.
        Value::Array(a) => {
            let nf = match args.get(5) {
                Some(Expr::Missing) | None => Value::Error(CalcError::NA),
                Some(e) => ctx.eval(e)?,
            };
            let cells: Vec<Value> = a
                .cells()
                .iter()
                .map(|c| element(c, &delim, instance, insensitive, match_end, before, &nf))
                .collect();
            return Ok(
                match calc_core::array::ArrayValue::new(a.rows(), a.cols(), cells) {
                    Ok(arr) => Value::Array(arr),
                    Err(e) => Value::Error(e),
                },
            );
        }
        v => match v.to_text() {
            Ok(s) => s,
            Err(e) => return Ok(Value::Error(e)),
        },
    };
    match find_instance(&text, &delim, instance, insensitive, match_end) {
        Err(e) => Ok(Value::Error(e)),
        Ok(None) => if_not_found(ctx, args),
        Ok(Some((s, e))) => Ok(Value::Text(if before {
            text[..s].to_string()
        } else {
            text[e..].to_string()
        })),
    }
}

/// One element of an array `text` argument: not-found resolves to the
/// (eagerly evaluated) `if_not_found` value.
fn element(
    v: &Value,
    delim: &str,
    instance: i64,
    insensitive: bool,
    match_end: bool,
    before: bool,
    nf: &Value,
) -> Value {
    let text = match v.to_text() {
        Ok(s) => s,
        Err(e) => return Value::Error(e),
    };
    match find_instance(&text, delim, instance, insensitive, match_end) {
        Ok(Some((s, e))) => Value::Text(if before {
            text[..s].to_string()
        } else {
            text[e..].to_string()
        }),
        Ok(None) => nf.clone(),
        Err(e) => Value::Error(e),
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    split_at_impl(ctx, args, true)
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
        assert_eq!(t(&eval(r#"=TEXTBEFORE("Red fox jumps"," ")"#)), "Red");
        assert_eq!(t(&eval(r#"=TEXTBEFORE("abc","b")"#)), "a");
    }

    #[test]
    fn second_instance() {
        assert_eq!(t(&eval(r#"=TEXTBEFORE("a-b-c","-",2)"#)), "a-b");
    }

    #[test]
    fn negative_instance_from_right() {
        assert_eq!(t(&eval(r#"=TEXTBEFORE("a-b-c","-",-1)"#)), "a-b");
        assert_eq!(t(&eval(r#"=TEXTBEFORE("a-b-c","-",-2)"#)), "a");
    }

    #[test]
    fn case_sensitivity() {
        assert_eq!(e(&eval(r#"=TEXTBEFORE("ABC","abc")"#)), CalcError::NA);
        assert_eq!(t(&eval(r#"=TEXTBEFORE("ABC","abc",1,1)"#)), "");
    }

    #[test]
    fn not_found() {
        assert_eq!(e(&eval(r#"=TEXTBEFORE("abc","z")"#)), CalcError::NA);
        assert_eq!(t(&eval(r#"=TEXTBEFORE("abc","z",1,0,0,"none")"#)), "none");
    }

    #[test]
    fn instance_beyond_count_is_na() {
        assert_eq!(e(&eval(r#"=TEXTBEFORE("a-b","-",2)"#)), CalcError::NA);
        assert_eq!(t(&eval(r#"=TEXTBEFORE("a-b","-",2,0,0,"nf")"#)), "nf");
    }

    #[test]
    fn match_end_treats_end_as_delimiter() {
        // Delimiter absent: positive instance finds the virtual end
        // delimiter -> whole text before it.
        assert_eq!(t(&eval(r#"=TEXTBEFORE("abc","z",1,0,1)"#)), "abc");
        // Second instance of "-" in "a-b" is the virtual end delimiter.
        assert_eq!(t(&eval(r#"=TEXTBEFORE("a-b","-",2,0,1)"#)), "a-b");
        // Negative: virtual delimiter at start -> "".
        assert_eq!(t(&eval(r#"=TEXTBEFORE("abc","z",-1,0,1)"#)), "");
    }

    #[test]
    fn match_end_overrides_if_not_found() {
        assert_eq!(t(&eval(r#"=TEXTBEFORE("abc","z",1,0,1,"nf")"#)), "abc");
    }

    #[test]
    fn invalid_instance() {
        assert_eq!(e(&eval(r#"=TEXTBEFORE("a-b","-",0)"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=TEXTBEFORE("a-b","-",9)"#)), CalcError::Value);
    }

    #[test]
    fn empty_delimiter_matches_immediately() {
        assert_eq!(t(&eval(r#"=TEXTBEFORE("abc","")"#)), "");
        assert_eq!(t(&eval(r#"=TEXTBEFORE("abc","",-1)"#)), "abc");
    }

    #[test]
    fn multichar_delimiter() {
        assert_eq!(t(&eval(r#"=TEXTBEFORE("a<->b<->c","<->",-1)"#)), "a<->b");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=TEXTBEFORE(1/0,"x")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=TEXTBEFORE("x",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=TEXTBEFORE("x")"#)), CalcError::Value);
    }
}
