//! Regex engine shared by `REGEXTEST`/`REGEXEXTRACT`/`REGEXREPLACE`
//! (v3, Microsoft 365 functions). Specs: `docs/functions/REGEX*.md`.
//!
//! # Dialect (SPEC-OPEN)
//!
//! Excel ships the ECMAScript (JavaScript) regex dialect. The engine
//! uses the `regex` crate (Rust syntax — RE2-style): the common feature
//! set (classes, quantifiers, groups, alternation, anchors, `\d`/`w`/`s`,
//! named groups) matches, but JavaScript constructs Rust deliberately
//! rejects — look-around (`(?=`, `(?!`, `(?<=`, `(?<!`) and
//! backreferences (`\1`) — are `#VALUE!` here. Malformed patterns are
//! `#VALUE!` per the spec doc's expected error identity (the `#CALC!`
//! alternative is recorded as an open question there).
//!
//! `case_sensitivity = 1` maps to `(?i)` — Rust's Unicode-aware
//! case-insensitive matching, which is broader than JavaScript's ASCII
//! `i` flag; edge-case fixtures are `specOpen`.

use calc_core::error::CalcError;
use regex::{Regex, RegexBuilder};

/// Compile `pattern` for a REGEX* `case_sensitivity` flag
/// (`0` sensitive, `1` insensitive; any other value is `#VALUE!`).
/// A pattern that fails to compile is `#VALUE!`.
pub fn compile(pattern: &str, case_sensitivity: i64) -> Result<Regex, CalcError> {
    let insensitive = match case_sensitivity {
        0 => false,
        1 => true,
        _ => return Err(CalcError::Value),
    };
    RegexBuilder::new(pattern)
        .case_insensitive(insensitive)
        .unicode(true)
        .build()
        .map_err(|_| CalcError::Value)
}

/// Expand a JavaScript-style replacement template against `caps`:
/// `$1`..`$99`/`${name}` capture references, `$0`/`$&` the whole match,
/// `$$` a literal `$`. A dangling `$` is emitted literally.
///
/// The `regex` crate's own `Replacer` would silently drop unknown
/// `$name` references and treat a trailing `$` as an error; doing the
/// expansion manually keeps unmatched/unknown references empty
/// (JavaScript keeps them literal — SPEC-OPEN, recorded in fixtures).
pub fn expand(template: &str, caps: &regex::Captures<'_>) -> String {
    let bytes = template.as_bytes();
    let mut out = String::with_capacity(template.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'$' || i + 1 >= bytes.len() {
            // Copy the next char wholesale (multibyte-safe).
            let ch = template[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        match bytes[i + 1] {
            b'$' => {
                out.push('$');
                i += 2;
            }
            b'&' => {
                out.push_str(&caps[0]);
                i += 2;
            }
            b'{' => {
                let end = template[i + 2..].find('}').map(|e| e + i + 2);
                match end {
                    Some(e) => {
                        let name = &template[i + 2..e];
                        push_capture(&mut out, caps, name);
                        i = e + 1;
                    }
                    None => {
                        out.push('$');
                        i += 1;
                    }
                }
            }
            b'0'..=b'9' => {
                // Greedy two-digit reference: $12 -> group 12 when it
                // exists, else $1 followed by literal "2" is NOT what
                // JavaScript does (it takes $12 = group 12 regardless);
                // take the two-digit number unconditionally.
                let mut j = i + 1;
                let mut num = String::new();
                while j < bytes.len() && bytes[j].is_ascii_digit() && num.len() < 2 {
                    num.push(bytes[j] as char);
                    j += 1;
                }
                push_capture(&mut out, caps, &num);
                i = j;
            }
            _ => {
                // `$x` with non-reference x: emit `$` literally.
                out.push('$');
                i += 1;
            }
        }
    }
    out
}

fn push_capture(out: &mut String, caps: &regex::Captures<'_>, name: &str) {
    let group = if name.chars().all(|c| c.is_ascii_digit()) {
        name.parse::<usize>().ok().map(|g| caps.get(g))
    } else {
        Some(caps.name(name))
    };
    if let Some(Some(m)) = group {
        out.push_str(m.as_str());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_pattern_is_value_error() {
        assert!(compile("[", 0).is_err());
        assert!(compile("(", 0).is_err());
        assert!(compile("(?=x)", 0).is_err()); // look-around unsupported
        assert!(compile(r"(a)\1", 0).is_err()); // backreference unsupported
    }

    #[test]
    fn case_flag() {
        assert!(compile("abc", 0).unwrap().is_match("abc"));
        assert!(!compile("abc", 0).unwrap().is_match("ABC"));
        assert!(compile("abc", 1).unwrap().is_match("ABC"));
        assert!(compile("abc", 2).is_err());
    }

    #[test]
    fn expand_references() {
        let re = compile(r"(\d+)-(\d+)", 0).unwrap();
        let caps = re.captures("15-20").unwrap();
        assert_eq!(expand("$2/$1", &caps), "20/15");
        assert_eq!(expand("$0", &caps), "15-20");
        assert_eq!(expand("$&", &caps), "15-20");
        assert_eq!(expand("$$x", &caps), "$x");
        assert_eq!(expand("$9", &caps), "");
        assert_eq!(expand("a$", &caps), "a$");
    }
}
