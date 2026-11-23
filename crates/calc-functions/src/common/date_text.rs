//! Text↔date coercion layer for the v3 date/time functions
//! (i20): the deterministic grammar Excel leaves locale-dependent.
//!
//! `DATEVALUE`/`TIMEVALUE` cannot reproduce the host system's short-date
//! settings offline, so this module owns a fixed, documented grammar:
//!
//! - Dates: ISO `YYYY-MM-DD`/`YYYY/MM/DD`, en-US `M/D/YYYY` & `M/D/YY`
//!   (also `-` separators), `D-Mon-YYYY`/`D Mon YYYY` (3-letter or full
//!   English month names), `Month D, YYYY`/`Month D YYYY`. A trailing
//!   time part (`"2026-01-01 15:00"`, space- or `T`-separated) is
//!   accepted and discarded.
//! - Two-digit years use the fixed Windows-default pivot: `00..=29` →
//!   2000s, `30..=99` → 1900s.
//! - Times: `H:MM`, `H:MM:SS`, optional `AM`/`PM` (case-insensitive,
//!   optional space). Hours ≥ 24 wrap modulo 24 (SPEC-OPEN: Excel
//!   accepts `"25:00"` as next-day 1:00 — wrapping chosen over error).
//!
//! Also owns the scalar date-argument coercion shared by every function
//! in this track (number → serial, text → grammar parse, boolean →
//! `#VALUE!`), the holiday-list collector for `NETWORKDAYS`/`WORKDAY`,
//! and the `*.INTL` weekend-mask parser.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::value::Value;
use calc_core::workbook::DateSystem;

use crate::common::date_serial;

/// Evaluate `arg` and coerce the scalar result to an integer date
/// serial under the i20 date-argument rules: numbers truncate toward
/// zero and must fall in the serial domain (`#NUM!` otherwise); text
/// parses via [`parse_date_text`] (`#VALUE!` on failure — numeric text
/// like `"45000"` is rejected the way `DATEVALUE` rejects it); booleans
/// are `#VALUE!`; errors propagate. Blank coerces to serial `0`.
pub fn eval_date(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<i64, CalcError>, EvalError> {
    let v = ctx.eval(arg)?;
    Ok(date_value_to_serial(&v, ctx.date_system()))
}

/// Coercion kernel for [`eval_date`], split out for testability.
fn date_value_to_serial(v: &Value, system: DateSystem) -> Result<i64, CalcError> {
    match v {
        Value::Text(s) => parse_date_text(s, system).ok_or(CalcError::Value),
        Value::Boolean(_) => Err(CalcError::Value),
        Value::Error(e) => Err(*e),
        _ => {
            let n = v.to_number()?;
            if !n.is_finite() {
                return Err(CalcError::Num);
            }
            let s = date_serial::trunc_to_i64(n);
            if s < 0 || s > date_serial::max_serial(system) {
                return Err(CalcError::Num);
            }
            Ok(s)
        }
    }
}

/// Parse date text into an integer serial under `system`. Grammar as
/// documented in the module header; returns `None` for anything else
/// (including out-of-domain results and bare numbers).
pub fn parse_date_text(s: &str, system: DateSystem) -> Option<i64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if let Some((y, m, d)) = parse_date_only(t) {
        return date_serial::date_to_serial(y, m, d as i64, system);
    }
    // Date + trailing time: split at the last whitespace or 'T' that
    // leaves a parseable time suffix.
    for (i, c) in t.char_indices().rev() {
        if c == ' ' || c == 'T' || c == 't' {
            let (date_part, time_part) = (&t[..i], t[i + 1..].trim());
            if time_part.is_empty() {
                continue;
            }
            if let Some((y, m, d)) = parse_date_only(date_part.trim()) {
                if parse_time_only(time_part).is_some() {
                    return date_serial::date_to_serial(y, m, d as i64, system);
                }
            }
        }
    }
    None
}

/// Parse time text into a day fraction in `[0, 1)`. Accepts a bare time
/// or a date+time string (date part validated and discarded).
/// Returns `None` for anything else.
pub fn parse_time_text(s: &str) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(f) = parse_time_only(t) {
        return Some(f);
    }
    // Date + time: the time tail must parse and the date head must be a
    // valid date (validated against the 1900 calendar — validity is
    // calendar-independent except fictitious 1900-02-29, which never
    // occurs in text anyway).
    for (i, c) in t.char_indices().rev() {
        if c == ' ' || c == 'T' || c == 't' {
            let (date_part, time_part) = (&t[..i], t[i + 1..].trim());
            if time_part.is_empty() {
                continue;
            }
            if let Some(f) = parse_time_only(time_part) {
                if parse_date_only(date_part.trim()).is_some() {
                    return Some(f);
                }
            }
        }
    }
    None
}

/// `(year, month, day)` of the date-only grammar. `day` is validated
/// against the real Gregorian calendar (the fictitious 1900-02-29 is
/// reachable via serial arithmetic but not via text).
fn parse_date_only(t: &str) -> Option<(i64, u32, u32)> {
    let bytes = t.as_bytes();
    // ISO: YYYY-MM-DD or YYYY/MM/DD (4+-digit year first).
    if bytes.len() >= 8 && bytes[0].is_ascii_digit() {
        let mut it = t.split(['-', '/']);
        let a = it.next()?;
        if a.len() >= 3 && a.chars().all(|c| c.is_ascii_digit()) {
            let (b, c) = (it.next()?, it.next()?);
            if it.next().is_none() {
                let (y, m, d) = (num(a)?, num(b)?, num(c)?);
                return valid_ymd(y, m, d);
            }
        }
    }
    // Tokenized forms.
    let toks: Vec<&str> = t
        .split(['/', '-', ' ', ','])
        .filter(|s| !s.is_empty())
        .collect();
    if toks.len() == 3 {
        // M/D/Y (en-US numeric): first two tokens numeric, last is year.
        if let (Some(m), Some(d), Some(y)) = (num(toks[0]), num(toks[1]), num(toks[2])) {
            return valid_ymd(pivot_year(y, toks[2])?, m, d);
        }
        // D-Mon-Y / D Mon Y.
        if let (Some(d), Some(m), Some(y)) = (num(toks[0]), month_num(toks[1]), num(toks[2])) {
            return valid_ymd(pivot_year(y, toks[2])?, m.into(), d);
        }
        // Month D Y.
        if let (Some(m), Some(d), Some(y)) = (month_num(toks[0]), num(toks[1]), num(toks[2])) {
            return valid_ymd(pivot_year(y, toks[2])?, m.into(), d);
        }
    }
    None
}

/// Strict numeric token (ASCII digits only).
fn num(t: &str) -> Option<i64> {
    if !t.is_empty() && t.bytes().all(|b| b.is_ascii_digit()) {
        t.parse().ok()
    } else {
        None
    }
}

/// Apply the two-digit-year pivot; reject non-positive years.
fn pivot_year(y: i64, tok: &str) -> Option<i64> {
    Some(if tok.len() <= 2 {
        if y <= 29 { 2000 + y } else { 1900 + y }
    } else {
        y
    })
}

/// English month name/number → 1..=12 (3-letter prefix match, so
/// "Dec"/"December" both work; also bare numbers).
fn month_num(t: &str) -> Option<u32> {
    const NAMES: [&str; 12] = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    let lower = t.to_ascii_lowercase();
    if let Some(n) = num(&lower) {
        return (1..=12).contains(&n).then_some(n as u32);
    }
    NAMES
        .iter()
        .position(|name| lower.starts_with(name))
        .map(|i| i as u32 + 1)
}

/// Validate a `(y, m, d)` triple against the real Gregorian calendar.
fn valid_ymd(y: i64, m: i64, d: i64) -> Option<(i64, u32, u32)> {
    if !(1..=12).contains(&m) || !(1..=9999).contains(&y) || d < 1 {
        return None;
    }
    let dim = date_serial::days_in_month(y, m as u32, DateSystem::Excel1904);
    if d > dim as i64 {
        return None;
    }
    Some((y, m as u32, d as u32))
}

/// Day fraction of a bare time string (`H:MM`, `H:MM:SS`, optional
/// AM/PM). Hours wrap modulo 24 (SPEC-OPEN: see module header).
fn parse_time_only(t: &str) -> Option<f64> {
    let mut s = t.trim();
    let mut pm = None;
    let upper = s.to_ascii_uppercase();
    for (suffix, is_pm) in [("AM", false), ("PM", true)] {
        if upper.ends_with(suffix) {
            s = s[..s.len() - suffix.len()].trim_end();
            pm = Some(is_pm);
            break;
        }
    }
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return None;
    }
    let (h, m) = (num(parts[0])?, num(parts[1])?);
    let sec = if parts.len() == 3 {
        // Allow fractional seconds ("SS.sss").
        parts[2].parse::<f64>().ok()?
    } else {
        0.0
    };
    if m > 59 || sec >= 60.0 || sec < 0.0 {
        return None;
    }
    let h = match pm {
        Some(true) if (1..=12).contains(&h) => h % 12 + 12,
        Some(false) if (1..=12).contains(&h) => h % 12,
        Some(_) => return None, // AM/PM requires 1..=12
        None => h,
    };
    Some(((h % 24) as f64 + m as f64 / 60.0 + sec / 3600.0) / 24.0)
}

/// Collect the `holidays` argument of `NETWORKDAYS`/`WORKDAY`:
/// numbers in a range or array count (blank/text/logical members are
/// ignored per the range-member rule; error members propagate).
/// A scalar argument coerces via [`eval_date`]-equivalent rules.
pub fn collect_holidays(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<Vec<i64>, CalcError>, EvalError> {
    let system = ctx.date_system();
    let members: Vec<(Value, bool)> = match ctx.eval_arg(arg)? {
        ArgValue::Scalar(Value::Array(a)) => a.into_iter().map(|v| (v, false)).collect(),
        ArgValue::Range(a) => a.into_iter().map(|v| (v, true)).collect(),
        ArgValue::Scalar(v) => vec![(v, false)],
        ArgValue::Ref(v) => vec![(v, true)],
    };
    let mut out = Vec::new();
    for (v, ranged) in members {
        if let Some(e) = v.error() {
            return Ok(Err(e));
        }
        match (&v, ranged) {
            (Value::Number(n), _) => {
                let s = date_serial::trunc_to_i64(*n);
                if s >= 0 && s <= date_serial::max_serial(system) {
                    out.push(s);
                }
            }
            (_, true) => {} // range members: non-numbers ignored
            (Value::Text(_), false) | (Value::Boolean(_), false) => {
                match date_value_to_serial(&v, system) {
                    Ok(s) => out.push(s),
                    Err(e) => return Ok(Err(e)),
                }
            }
            (_, false) => match v.to_number() {
                Ok(n) => out.push(date_serial::trunc_to_i64(n)),
                Err(e) => return Ok(Err(e)),
            },
        }
    }
    out.sort_unstable();
    out.dedup();
    Ok(Ok(out))
}

/// `*.INTL` weekend specifier → per-weekday flags indexed Monday=0 ..
/// Sunday=6 (`true` = weekend day). A number selects a code pair, a
/// 7-character `'0'`/`'1'` string is the Monday..Sunday mask.
/// Anything else is `Err(CalcError::Value)`.
pub fn weekend_mask(v: &Value) -> Result<[bool; 7], CalcError> {
    /// Numeric code → `(first day Mon0, second day Mon0 or same)`.
    fn pair(first: usize, second: usize) -> [bool; 7] {
        let mut m = [false; 7];
        m[first] = true;
        m[second] = true;
        m
    }
    match v {
        Value::Text(s) => {
            let t = s.trim();
            if t.len() != 7 || !t.bytes().all(|b| b == b'0' || b == b'1') {
                return Err(CalcError::Value);
            }
            let mut m = [false; 7];
            for (i, b) in t.bytes().enumerate() {
                m[i] = b == b'1';
            }
            Ok(m)
        }
        Value::Number(n) => Ok(match date_serial::trunc_to_i64(*n) {
            1 => pair(5, 6),  // Sat+Sun
            2 => pair(6, 0),  // Sun+Mon
            3 => pair(0, 1),  // Mon+Tue
            4 => pair(1, 2),  // Tue+Wed
            5 => pair(2, 3),  // Wed+Thu
            6 => pair(3, 4),  // Thu+Fri
            7 => pair(4, 5),  // Fri+Sat
            11 => pair(6, 6), // Sun only
            12 => pair(0, 0), // Mon only
            13 => pair(1, 1), // Tue
            14 => pair(2, 2), // Wed
            15 => pair(3, 3), // Thu
            16 => pair(4, 4), // Fri
            17 => pair(5, 5), // Sat
            _ => return Err(CalcError::Value),
        }),
        Value::Boolean(b) => weekend_mask(&Value::Number(if *b { 1.0 } else { 0.0 })),
        Value::Error(e) => Err(*e),
        _ => Err(CalcError::Value),
    }
}

/// Excel weekday of an integer serial: `0` = Monday .. `6` = Sunday.
/// Serials count linearly (the fictitious 1900-02-29 occupies a real
/// slot), so `serial % 7` maps `1` → Sunday … `0` → Saturday exactly
/// the way Excel's internal weekday does.
pub fn weekday_mon0(serial: i64) -> i64 {
    (serial.rem_euclid(7) + 5) % 7
}
