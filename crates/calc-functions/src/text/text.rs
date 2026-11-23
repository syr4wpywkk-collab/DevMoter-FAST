//! `TEXT(value, format_text)` — formats a number (or date serial) as
//! text using a format code. Spec: `docs/functions/TEXT.md`.
//!
//! Supported subset (anything else is `#VALUE!`, never a silently wrong
//! string):
//!
//! - number placeholders `0` `#` `?`, `.` decimal point, `,` thousands
//!   grouping inside the integer part, `%` percent (multiplies by 100)
//! - date codes `yyyy` `yy` `mm` `m` `dd` `d` (workbook date system)
//! - up to 2 `;` sections (`positive;negative`), `"..."` quoted
//!   literals, `@` text placeholder
//!
//! Unsupported (all rejected): scientific `E`, colors `[Red]`,
//! conditions `[>100]`, locale prefixes `[$-409]`, `mmm`/`ddd` names,
//! `h`/`s`/`AM/PM`/elapsed time, `*x`/`_x`/`\` escapes, `General`,
//! scaling commas.

use crate::common::{coercion, date_serial};
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Lit(String),
    /// Integer digit placeholder.
    Int(char),
    /// Decimal point inside the digit field.
    Dot,
    /// Fraction digit placeholder.
    Frac(char),
    /// `%`: multiplies by 100 and prints literally.
    Percent,
    /// Date fields: (kind, padded). kind 'y'|'m'|'d'.
    Date(char, bool),
    /// `@` text placeholder.
    Text,
}

#[derive(Debug, Default)]
struct Section {
    toks: Vec<Tok>,
    grouping: bool,
}

/// Split a format string into `;` sections, honoring `"..."` quotes.
fn split_sections(fmt: &str) -> Result<Vec<String>, CalcError> {
    let mut sections = Vec::new();
    let mut cur = String::new();
    let mut chars = fmt.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                cur.push('"');
                for c2 in chars.by_ref() {
                    cur.push(c2);
                    if c2 == '"' {
                        break;
                    }
                }
            }
            ';' => sections.push(std::mem::take(&mut cur)),
            c => cur.push(c),
        }
    }
    sections.push(cur);
    Ok(sections)
}

/// Parse one section into tokens. `Err` = outside the supported subset.
fn parse_section(s: &str) -> Result<Section, CalcError> {
    let mut sec = Section::default();
    let mut in_frac = false;
    // Once a digit field has seen a non-digit token, later digit
    // placeholders form a second field — outside the subset.
    let mut digits_closed = false;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        let tok: Tok;
        match c {
            '"' => {
                let mut lit = String::new();
                let mut closed = false;
                for c in chars.by_ref() {
                    if c == '"' {
                        closed = true;
                        break;
                    }
                    lit.push(c);
                }
                if !closed {
                    return Err(CalcError::Value);
                }
                tok = Tok::Lit(lit);
            }
            '0' | '#' | '?' => {
                if digits_closed {
                    return Err(CalcError::Value); // second digit field
                }
                tok = if in_frac { Tok::Frac(c) } else { Tok::Int(c) };
            }
            '.' => {
                // A '.' starts the fraction only inside/adjacent to the
                // digit field; a stray '.' is a literal.
                let starts_field = matches!(sec.toks.last(), Some(Tok::Int(_)))
                    || matches!(chars.peek(), Some('0' | '#' | '?'));
                if starts_field && !in_frac && !digits_closed {
                    in_frac = true;
                    tok = Tok::Dot;
                } else {
                    tok = Tok::Lit(".".to_string());
                }
            }
            ',' => {
                // Thousands grouping only between integer placeholders.
                let between = matches!(sec.toks.last(), Some(Tok::Int(_)))
                    && matches!(chars.peek(), Some('0' | '#' | '?'));
                if between {
                    sec.grouping = true;
                    continue;
                }
                return Err(CalcError::Value); // scaling/stray comma
            }
            '%' => tok = Tok::Percent,
            'y' | 'Y' => {
                let n = 1 + take_run(&mut chars, c);
                tok = match n {
                    2 => Tok::Date('y', false),
                    n if n >= 3 => Tok::Date('y', true),
                    _ => return Err(CalcError::Value),
                };
            }
            'm' | 'M' => {
                let n = 1 + take_run(&mut chars, c);
                tok = match n {
                    1 => Tok::Date('m', false),
                    2 => Tok::Date('m', true),
                    _ => return Err(CalcError::Value), // mmm+ unsupported
                };
            }
            'd' | 'D' => {
                let n = 1 + take_run(&mut chars, c);
                tok = match n {
                    1 => Tok::Date('d', false),
                    2 => Tok::Date('d', true),
                    _ => return Err(CalcError::Value), // ddd+ unsupported
                };
            }
            '@' => tok = Tok::Text,
            // Literal characters Excel passes through unquoted.
            ' ' | '-' | '/' | ':' | '(' | ')' | '+' => tok = Tok::Lit(c.to_string()),
            '1'..='9' => tok = Tok::Lit(c.to_string()),
            _ => return Err(CalcError::Value), // every other code letter/char
        }
        if !matches!(tok, Tok::Int(_) | Tok::Frac(_) | Tok::Dot)
            && sec
                .toks
                .iter()
                .any(|t| matches!(t, Tok::Int(_) | Tok::Frac(_)))
        {
            digits_closed = true;
        }
        sec.toks.push(tok);
    }
    Ok(sec)
}

fn take_run(chars: &mut std::iter::Peekable<std::str::Chars<'_>>, c: char) -> usize {
    let mut n = 0;
    while chars.peek() == Some(&c) {
        chars.next();
        n += 1;
    }
    n
}

/// Round `v` to `places` decimal places (half away from zero on the
/// 15-significant-digit decimal representation, as in `math::round`)
/// and return `(integer_digits, fraction_digits)`.
fn round_places(v: f64, places: usize) -> (String, String) {
    if v == 0.0 || !v.is_finite() {
        return ("0".to_string(), "0".repeat(places));
    }
    // 15 significant decimal digits: "d.dddddddddddddde±XX".
    let s = format!("{:.14e}", v);
    let (mant, exp) = s.split_once('e').unwrap();
    let mut exp10: i32 = exp.parse::<i32>().unwrap() + 1;
    let mut d: Vec<u8> = mant.bytes().filter(|b| b.is_ascii_digit()).collect();
    // Keep exp10 + places digits, round the rest half away from zero.
    let keep = exp10 + places as i32;
    if keep <= 0 {
        return ("0".to_string(), "0".repeat(places));
    }
    if (keep as usize) < d.len() {
        let keep = keep as usize;
        if d[keep] >= b'5' {
            let mut i = keep;
            loop {
                if i == 0 {
                    // carry grew the number: 9.99 -> 10, exponent +1
                    d = vec![b'1'];
                    d.resize(keep, b'0');
                    exp10 += 1;
                    break;
                }
                i -= 1;
                if d[i] == b'9' {
                    d[i] = b'0';
                } else {
                    d[i] += 1;
                    break;
                }
            }
        }
        d.truncate(keep);
    }
    // Digit d[k] sits at decimal place exp10-1-k.
    let mut int = String::new();
    for k in 0..exp10.max(0) {
        int.push(d.get(k as usize).copied().unwrap_or(b'0') as char);
    }
    if int.is_empty() {
        int.push('0');
    }
    let mut frac = String::new();
    for k in exp10.max(0)..exp10 + places as i32 {
        frac.push(d.get(k as usize).copied().unwrap_or(b'0') as char);
    }
    (int, frac)
}

/// Render one numeric section for `v` (already non-negative, unscaled).
fn render_number(sec: &Section, v: f64) -> Result<String, CalcError> {
    let pct = sec.toks.iter().filter(|t| **t == Tok::Percent).count();
    let v = v * 100f64.powi(pct as i32);
    let int_ph: Vec<char> = sec
        .toks
        .iter()
        .filter_map(|t| match t {
            Tok::Int(c) => Some(*c),
            _ => None,
        })
        .collect();
    let frac_ph: Vec<char> = sec
        .toks
        .iter()
        .filter_map(|t| match t {
            Tok::Frac(c) => Some(*c),
            _ => None,
        })
        .collect();
    let has_digits = !int_ph.is_empty() || !frac_ph.is_empty();
    let (int_digits, frac_digits) = if has_digits {
        round_places(v, frac_ph.len())
    } else {
        (String::new(), String::new())
    };

    // Fill integer placeholders right-to-left: digits occupy the
    // rightmost positions; remaining leading slots print '0' for `0`,
    // ' ' for `?`, and nothing for `#`.
    let digits: Vec<char> = int_digits.chars().collect();
    // A value whose integer part is 0 supplies no significant digit:
    // `#`/`?` placeholders then emit padding only (so `"#.##"` of 0.5
    // prints `.5`), matching Excel's insignificant-zero suppression.
    let int_zero = digits.iter().all(|c| *c == '0');
    let mut di = if int_zero { 0 } else { digits.len() };
    let mut tail_rev = String::new();
    for &ph in int_ph.iter().rev() {
        if di > 0 {
            di -= 1;
            tail_rev.push(digits[di]);
        } else {
            match ph {
                '0' => tail_rev.push('0'),
                '?' => tail_rev.push(' '),
                _ => {}
            }
        }
    }
    let mut int_out: String = digits[..di].iter().collect();
    int_out.extend(tail_rev.chars().rev());
    if sec.grouping {
        int_out = group_thousands(&int_out);
    }

    // Fill fraction placeholders. Positions left of the last forced
    // (`0`/`?`) placeholder and every significant digit print; trailing
    // zeros in the all-optional tail print as ' ' for `?` and drop for
    // `#`.
    let forced_len = frac_ph
        .iter()
        .rposition(|p| *p != '#')
        .map(|i| i + 1)
        .unwrap_or(0);
    let fd: Vec<char> = frac_digits.chars().collect();
    let sig_len = fd
        .iter()
        .rposition(|d| *d != '0')
        .map(|i| i + 1)
        .unwrap_or(0);
    let mut frac_out = String::new();
    for (i, &ph) in frac_ph.iter().enumerate() {
        let d = fd.get(i).copied().unwrap_or('0');
        if i < forced_len || i < sig_len {
            frac_out.push(d);
        } else if ph == '?' {
            frac_out.push(' ');
        }
    }

    // Assemble the token stream: the digit runs emit once, at their
    // first placeholder.
    let mut out = String::new();
    let mut int_done = false;
    let mut frac_done = false;
    for t in &sec.toks {
        match t {
            Tok::Lit(s) => out.push_str(s),
            Tok::Int(_) => {
                if !int_done {
                    out.push_str(&int_out);
                    int_done = true;
                }
            }
            Tok::Dot => {
                // Excel keeps the point when any fraction digit printed
                // or the fraction has forced placeholders; an all-`#`
                // empty fraction drops it (SPEC-OPEN: verify vs Excel).
                if !frac_out.is_empty() || frac_ph.is_empty() || forced_len > 0 {
                    out.push('.');
                }
            }
            Tok::Frac(_) => {
                if !frac_done {
                    out.push_str(&frac_out);
                    frac_done = true;
                }
            }
            Tok::Percent => out.push('%'),
            Tok::Date(..) | Tok::Text => return Err(CalcError::Value),
        }
    }
    Ok(out)
}

/// Insert `,` separators every 3 digits, skipping non-digit padding.
fn group_thousands(s: &str) -> String {
    let digits = s.chars().filter(|c| c.is_ascii_digit()).count();
    let mut seen = 0usize;
    let mut out = String::with_capacity(s.len() + digits / 3);
    for c in s.chars() {
        if c.is_ascii_digit() {
            if seen > 0 && (digits - seen) % 3 == 0 {
                out.push(',');
            }
            seen += 1;
        }
        out.push(c);
    }
    out
}

fn render_date(
    sec: &Section,
    serial: f64,
    ds: calc_core::workbook::DateSystem,
) -> Result<String, CalcError> {
    let (y, m, d) = date_serial::serial_to_ymd(serial, ds).ok_or(CalcError::Num)?;
    let mut out = String::new();
    for t in &sec.toks {
        match t {
            Tok::Lit(s) => out.push_str(s),
            Tok::Date('y', padded) => {
                if *padded {
                    out.push_str(&format!("{y:04}"));
                } else {
                    out.push_str(&format!("{:02}", y.rem_euclid(100)));
                }
            }
            Tok::Date('m', padded) => {
                if *padded {
                    out.push_str(&format!("{m:02}"));
                } else {
                    out.push_str(&m.to_string());
                }
            }
            Tok::Date('d', padded) => {
                if *padded {
                    out.push_str(&format!("{d:02}"));
                } else {
                    out.push_str(&d.to_string());
                }
            }
            _ => return Err(CalcError::Value),
        }
    }
    Ok(out)
}

fn render_text(sec: &Section, text: &str) -> Result<String, CalcError> {
    let mut out = String::new();
    let mut used = false;
    for t in &sec.toks {
        match t {
            Tok::Lit(s) => out.push_str(s),
            Tok::Text if !used => {
                out.push_str(text);
                used = true;
            }
            Tok::Text => {}
            _ => return Err(CalcError::Value),
        }
    }
    Ok(out)
}

fn section_kind(sec: &Section) -> u8 {
    if sec.toks.iter().any(|t| matches!(t, Tok::Date(..))) {
        2 // date
    } else if sec
        .toks
        .iter()
        .any(|t| matches!(t, Tok::Int(_) | Tok::Frac(_) | Tok::Dot | Tok::Percent))
    {
        1 // number
    } else {
        0 // literal/text
    }
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 2, 2) {
        return Ok(Value::Error(e));
    }
    let value = ctx.eval(&args[0])?;
    if let Some(e) = value.error() {
        return Ok(Value::Error(e));
    }
    let fmt = match coercion::eval_text(ctx, &args[1])? {
        Ok(s) => s,
        Err(e) => return Ok(Value::Error(e)),
    };
    if fmt.is_empty() {
        return Ok(Value::Error(CalcError::Value));
    }
    let sections = match split_sections(&fmt) {
        Ok(s) if s.len() <= 2 => s,
        _ => return Ok(Value::Error(CalcError::Value)),
    };
    let parsed: Vec<Section> = match sections
        .iter()
        .map(|s| parse_section(s))
        .collect::<Result<_, _>>()
    {
        Ok(p) => p,
        Err(e) => return Ok(Value::Error(e)),
    };

    let num = value.to_number();
    match num {
        Ok(v) => {
            let idx = if v < 0.0 && parsed.len() == 2 { 1 } else { 0 };
            let sec = &parsed[idx];
            let kind = section_kind(sec);
            let rendered = match kind {
                2 => render_date(sec, v, ctx.date_system()),
                1 | 0 => render_number(sec, v.abs()),
                _ => unreachable!(),
            };
            match rendered {
                Ok(s) => {
                    if v < 0.0 && parsed.len() == 1 && kind != 2 {
                        Ok(Value::Text(format!("-{s}")))
                    } else {
                        Ok(Value::Text(s))
                    }
                }
                Err(e) => Ok(Value::Error(e)),
            }
        }
        Err(e) => {
            // Non-numeric text: only the `@` text section can render it.
            if let Value::Text(s) = &value {
                if parsed.iter().any(|p| p.toks.contains(&Tok::Text)) {
                    let sec = parsed.iter().find(|p| p.toks.contains(&Tok::Text)).unwrap();
                    return match render_text(sec, s) {
                        Ok(t) => Ok(Value::Text(t)),
                        Err(e) => Ok(Value::Error(e)),
                    };
                }
            }
            Ok(Value::Error(e))
        }
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
    fn fixed_decimals() {
        assert_eq!(t(&eval(r#"=TEXT(1234.567,"0.00")"#)), "1234.57");
        assert_eq!(t(&eval(r#"=TEXT(2,"0.00")"#)), "2.00");
    }

    #[test]
    fn zero_padding() {
        assert_eq!(t(&eval(r#"=TEXT(42,"00000")"#)), "00042");
    }

    #[test]
    fn grouping() {
        assert_eq!(t(&eval(r##"=TEXT(1234567,"#,##0")"##)), "1,234,567");
    }

    #[test]
    fn percent() {
        assert_eq!(t(&eval(r#"=TEXT(0.5,"0%")"#)), "50%");
        assert_eq!(t(&eval(r#"=TEXT(0.125,"0.0%")"#)), "12.5%");
    }

    #[test]
    fn hash_suppresses_zeros() {
        assert_eq!(t(&eval(r##"=TEXT(0.5,"#.##")"##)), ".5");
        assert_eq!(t(&eval(r#"=TEXT(2.5,"0.##")"#)), "2.5");
    }

    #[test]
    fn negative_single_section() {
        assert_eq!(t(&eval(r#"=TEXT(-1.5,"0.0")"#)), "-1.5");
    }

    #[test]
    fn two_sections() {
        assert_eq!(t(&eval(r#"=TEXT(-1.5,"0.0;(0.0)")"#)), "(1.5)");
        assert_eq!(t(&eval(r#"=TEXT(1.5,"0.0;(0.0)")"#)), "1.5");
    }

    #[test]
    fn date_codes() {
        // serial 46349 = 2026-11-23 (1900 system)
        assert_eq!(t(&eval(r#"=TEXT(46349,"yyyy-mm-dd")"#)), "2026-11-23");
        assert_eq!(t(&eval(r#"=TEXT(46349,"m/d/yy")"#)), "11/23/26");
        assert_eq!(t(&eval(r#"=TEXT(1,"yyyy-m-d")"#)), "1900-1-1");
    }

    #[test]
    fn quoted_literals() {
        assert_eq!(t(&eval(r#"=TEXT(5,"""about"" 0")"#)), "about 5");
    }

    #[test]
    fn unsupported_codes_error() {
        assert_eq!(e(&eval(r#"=TEXT(1,"0.00E+00")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=TEXT(1,"General")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=TEXT(1,"mmm")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=TEXT(1,"[Red]0")"#)), CalcError::Value);
        assert_eq!(e(&eval(r#"=TEXT(1,"")"#)), CalcError::Value);
    }

    #[test]
    fn text_placeholder() {
        assert_eq!(t(&eval(r#"=TEXT("hi","@ ""there""")"#)), "hi there");
    }

    #[test]
    fn plain_text_without_at_is_value_error() {
        assert_eq!(e(&eval(r#"=TEXT("abc","0")"#)), CalcError::Value);
    }

    #[test]
    fn coercion() {
        assert_eq!(t(&eval(r#"=TEXT("3.5","0.0")"#)), "3.5");
        assert_eq!(t(&eval(r#"=TEXT(TRUE,"0")"#)), "1");
    }

    #[test]
    fn error_propagates() {
        assert_eq!(e(&eval(r#"=TEXT(1/0,"0")"#)), CalcError::DivZero);
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=TEXT(1)")), CalcError::Value);
    }
}
