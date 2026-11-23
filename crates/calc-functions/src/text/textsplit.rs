//! `TEXTSPLIT(text, col_delimiter, [row_delimiter], [ignore_empty],
//! [match_mode], [pad_with])` — splits text into a 2-D spilled array.
//! Spec: `docs/functions/TEXTSPLIT.md`.
//!
//! The text is scanned left to right; at each position the first
//! matching column delimiter starts a new column in the current row and
//! the first matching row delimiter starts a new row. Column delimiters
//! are tested before row delimiters at each position (delimiter
//! precedence is SPEC-OPEN in the spec doc). Each delimiter argument may
//! be a constant array of alternatives (`{"-",","}`). An empty-string
//! column delimiter splits the text into individual characters
//! (documented Excel behavior); `""` inside a delimiter *array* splits
//! per character on that axis too (SPEC-OPEN edge).
//!
//! `ignore_empty = TRUE` drops empty segments produced by adjacent or
//! edge delimiters. Ragged rows are padded with `pad_with` (default
//! `#N/A`). `text` is scalar-only per the spec doc.

use crate::common::coercion;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

/// Boundary kinds, in scan order.
enum Break {
    Col,
    Row,
}

/// Delimiter alternatives for one axis: the literal byte strings plus a
/// flag for the empty-string "split into characters" case.
struct Delims {
    list: Vec<String>,
    chars: bool,
}

impl Delims {
    /// Match any non-empty delimiter at `text[pos..]`; returns its byte
    /// length. Column delimiters are checked before row delimiters by
    /// the caller ordering.
    fn match_at(&self, text: &str, pos: usize, insensitive: bool) -> Option<usize> {
        let rest = &text[pos..];
        self.list.iter().filter(|d| !d.is_empty()).find_map(|d| {
            if rest.len() < d.len() {
                return None;
            }
            let candidate = &rest[..d.len()];
            let hit = if insensitive {
                candidate
                    .chars()
                    .flat_map(char::to_lowercase)
                    .eq(d.chars().flat_map(char::to_lowercase))
            } else {
                candidate == d.as_str()
            };
            hit.then_some(d.len())
        })
    }
}

/// Evaluate a delimiter argument: a scalar text value is one delimiter;
/// an array is the set of alternatives. `Missing` yields no delimiters.
fn eval_delims(
    ctx: &mut EvalContext<'_>,
    arg: Option<&Expr>,
) -> Result<Result<Delims, CalcError>, EvalError> {
    let v = match arg {
        Some(Expr::Missing) | None => {
            return Ok(Ok(Delims {
                list: Vec::new(),
                chars: false,
            }));
        }
        Some(e) => ctx.eval_arg(e)?.into_value(),
    };
    let mut list = Vec::new();
    let mut chars = false;
    let push = |s: String, list: &mut Vec<String>, chars: &mut bool| {
        if s.is_empty() {
            *chars = true;
        } else {
            list.push(s);
        }
    };
    match v {
        Value::Array(a) => {
            for c in a.cells() {
                match c.to_text() {
                    Ok(s) => push(s, &mut list, &mut chars),
                    Err(e) => return Ok(Err(e)),
                }
            }
        }
        v => match v.to_text() {
            Ok(s) => push(s, &mut list, &mut chars),
            Err(e) => return Ok(Err(e)),
        },
    }
    Ok(Ok(Delims { list, chars }))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 6) {
        return Ok(Value::Error(e));
    }
    let col = match eval_delims(ctx, args.get(1))? {
        Ok(d) => d,
        Err(e) => return Ok(Value::Error(e)),
    };
    let row = match eval_delims(ctx, args.get(2))? {
        Ok(d) => d,
        Err(e) => return Ok(Value::Error(e)),
    };
    let ignore_empty = match args.get(3) {
        Some(Expr::Missing) | None => false,
        Some(e) => match ctx.eval(e)?.to_boolean() {
            Ok(b) => b,
            Err(err) => return Ok(Value::Error(err)),
        },
    };
    let insensitive = match coercion::eval_opt_number(ctx, args.get(4), 0.0)? {
        Ok(n) if n.is_finite() => match n.trunc() as i64 {
            0 => false,
            1 => true,
            _ => return Ok(Value::Error(CalcError::Value)),
        },
        Ok(_) => return Ok(Value::Error(CalcError::Value)),
        Err(e) => return Ok(Value::Error(e)),
    };
    let pad = match args.get(5) {
        Some(Expr::Missing) | None => Value::Error(CalcError::NA),
        Some(e) => match ctx.eval_arg(e)?.into_value() {
            Value::Array(_) => return Ok(Value::Error(CalcError::Value)),
            v => v,
        },
    };
    let text = match coercion::eval_text(ctx, &args[0])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };

    // Tokenize: segments separated by Col/Row boundaries.
    let mut segments: Vec<(Break, String)> = Vec::new();
    let mut cur = String::new();
    let mut cur_kind = Break::Col; // kind of the boundary that led here
    let mut pos = 0usize;
    while pos <= text.len() {
        if pos == text.len() {
            segments.push((cur_kind, std::mem::take(&mut cur)));
            break;
        }
        let matched = if let Some(n) = col.match_at(&text, pos, insensitive) {
            Some((Break::Col, n))
        } else {
            row.match_at(&text, pos, insensitive)
                .map(|n| (Break::Row, n))
        };
        match matched {
            Some((kind, n)) => {
                segments.push((cur_kind, std::mem::take(&mut cur)));
                cur_kind = kind;
                pos += n;
            }
            None => {
                let c = text[pos..].chars().next().unwrap();
                // Empty col delimiter: boundary between characters.
                if col.chars && pos > 0 {
                    segments.push((cur_kind, std::mem::take(&mut cur)));
                    cur_kind = Break::Col;
                }
                cur.push(c);
                pos += c.len_utf8();
            }
        }
    }

    // Lay segments into the grid.
    let mut grid: Vec<Vec<Value>> = Vec::new();
    let mut row_buf: Vec<Value> = Vec::new();
    let flush = |grid: &mut Vec<Vec<Value>>, row_buf: &mut Vec<Value>| {
        grid.push(std::mem::take(row_buf));
    };
    for (kind, seg) in segments {
        if ignore_empty && seg.is_empty() {
            continue;
        }
        if matches!(kind, Break::Row) && !row_buf.is_empty() {
            flush(&mut grid, &mut row_buf);
        }
        row_buf.push(Value::Text(seg));
    }
    if !row_buf.is_empty() || grid.is_empty() {
        flush(&mut grid, &mut row_buf);
    }
    let cols = grid.iter().map(Vec::len).max().unwrap_or(1).max(1) as u32;
    let rows = grid.len() as u32;
    let mut cells = Vec::with_capacity(rows as usize * cols as usize);
    for r in &grid {
        for c in 0..cols as usize {
            cells.push(r.get(c).cloned().unwrap_or_else(|| pad.clone()));
        }
    }
    Ok(match ArrayValue::new(rows, cols, cells) {
        Ok(a) => Value::Array(a),
        Err(e) => Value::Error(e),
    })
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn arr(v: &Value) -> (u32, u32, Vec<Value>) {
        match v {
            Value::Array(a) => (a.rows(), a.cols(), a.cells().to_vec()),
            o => panic!("expected array, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    fn txt(v: &Value) -> String {
        match v {
            Value::Text(s) => s.clone(),
            o => panic!("expected text, got {o:?}"),
        }
    }

    #[test]
    fn col_split_row_of_cells() {
        let (r, c, cells) = arr(&eval(r#"=TEXTSPLIT("a,b,c",",")"#));
        assert_eq!((r, c), (1, 3));
        let got: Vec<String> = cells.iter().map(txt).collect();
        assert_eq!(got, ["a", "b", "c"]);
    }

    #[test]
    fn col_and_row_2d() {
        let (r, c, cells) = arr(&eval(r#"=TEXTSPLIT("a,b;c,d",",",";")"#));
        assert_eq!((r, c), (2, 2));
        let got: Vec<String> = cells.iter().map(txt).collect();
        assert_eq!(got, ["a", "b", "c", "d"]);
    }

    #[test]
    fn ragged_pads_with_na() {
        let (r, c, cells) = arr(&eval(r#"=TEXTSPLIT("a,b;c",",",";")"#));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[3], Value::Error(CalcError::NA));
    }

    #[test]
    fn pad_with_value() {
        let (r, c, cells) = arr(&eval(r#"=TEXTSPLIT("a,b;c",",",";",,0,"-")"#));
        assert_eq!((r, c), (2, 2));
        assert_eq!(cells[3], Value::Text("-".into()));
    }

    #[test]
    fn ignore_empty_drops() {
        let (r, c, cells) = arr(&eval(r#"=TEXTSPLIT("a;;b",";",,TRUE)"#));
        assert_eq!((r, c), (1, 2));
        let got: Vec<String> = cells.iter().map(txt).collect();
        assert_eq!(got, ["a", "b"]);
    }

    #[test]
    fn empties_kept_by_default() {
        let (r, c, cells) = arr(&eval(r#"=TEXTSPLIT("a;;b",";")"#));
        assert_eq!((r, c), (1, 3));
        assert_eq!(cells[1], Value::Text("".into()));
    }

    #[test]
    fn delimiter_array_alternatives() {
        let (r, c, cells) = arr(&eval(r#"=TEXTSPLIT("a-b,c",{",","-"})"#));
        assert_eq!((r, c), (1, 3));
        let got: Vec<String> = cells.iter().map(txt).collect();
        assert_eq!(got, ["a", "b", "c"]);
    }

    #[test]
    fn empty_col_delimiter_splits_chars() {
        let (r, c, cells) = arr(&eval(r#"=TEXTSPLIT("abc","")"#));
        assert_eq!((r, c), (1, 3));
        let got: Vec<String> = cells.iter().map(txt).collect();
        assert_eq!(got, ["a", "b", "c"]);
    }

    #[test]
    fn case_insensitive_mode() {
        let (r, c, _) = arr(&eval(r#"=TEXTSPLIT("aXb","x",,,1)"#));
        assert_eq!((r, c), (1, 2));
        let (r, c, _) = arr(&eval(r#"=TEXTSPLIT("aXb","x")"#));
        assert_eq!((r, c), (1, 1));
    }

    #[test]
    fn row_only_split() {
        let (r, c, cells) = arr(&eval(r#"=TEXTSPLIT("a;b",,";")"#));
        assert_eq!((r, c), (2, 1));
        let got: Vec<String> = cells.iter().map(txt).collect();
        assert_eq!(got, ["a", "b"]);
    }

    #[test]
    fn invalid_match_mode() {
        assert_eq!(e(&eval(r#"=TEXTSPLIT("a,b",",",,,2)"#)), CalcError::Value);
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=TEXTSPLIT(1/0,",")"#)), CalcError::DivZero);
        assert_eq!(e(&eval(r#"=TEXTSPLIT("a",1/0)"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval(r#"=TEXTSPLIT("a")"#)), CalcError::Value);
    }
}
