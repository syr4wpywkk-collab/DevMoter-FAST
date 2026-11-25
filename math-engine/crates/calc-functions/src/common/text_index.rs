//! Text indexing (v2 §3): Excel's 1-based character indexing shared by
//! `LEFT`/`RIGHT`/`MID`/`FIND`/`SEARCH`/`REPLACE`/`SUBSTITUTE` —
//! out-of-range clamps, empty-string positions and the Unicode
//! character boundary decisions (documented per function).
//!
//! # Counting unit
//!
//! Per `docs/functions/LEFT.md` Excel counts **UTF-16 code units**: a
//! character outside the Basic Multilingual Plane counts as 2. This
//! module adopts that rule (SPEC-OPEN GEN-005 records it as
//! unconfirmed against a reference implementation; fixtures for
//! non-BMP text are marked `specOpen`).
//!
//! Rust `String`s cannot hold a lone surrogate, so a slice boundary
//! that would fall inside a surrogate pair is resolved to a character
//! boundary instead:
//!
//! - *End* boundaries (`LEFT`/`MID` length limits) round **up**: the
//!   pair is included whole. `LEFT("😀x",1)` therefore returns `"😀"`.
//! - *Start* boundaries (`MID`/`FIND`/`REPLACE` start positions) round
//!   **down**: the pair preceding the requested offset is included.
//!   `MID("😀x",2,1)` returns `"x"` while `MID("😀x",1,1)` returns `"😀"`.

/// Number of UTF-16 code units in `s` — Excel's `LEN` counting unit.
pub fn len_units(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// Byte offset of the end boundary at `units` UTF-16 code units,
/// rounding up to a character boundary when `units` falls inside a
/// surrogate pair. Clamped to `s.len()`.
fn end_byte_at_unit(s: &str, units: usize) -> usize {
    if units == 0 {
        return 0;
    }
    let mut acc = 0usize;
    for (b, c) in s.char_indices() {
        acc += c.len_utf16();
        if acc >= units {
            return b + c.len_utf8();
        }
    }
    s.len()
}

/// Byte offset of the start boundary at `units` UTF-16 code units,
/// rounding down to a character boundary when `units` falls inside a
/// surrogate pair.
fn start_byte_at_unit(s: &str, units: usize) -> usize {
    let mut acc = 0usize;
    let mut last = 0usize;
    for (b, c) in s.char_indices() {
        if acc > units {
            break;
        }
        last = b;
        acc += c.len_utf16();
    }
    if acc <= units { s.len() } else { last }
}

/// Longest prefix of `s` taking at most `units` UTF-16 code units.
pub fn prefix_units(s: &str, units: usize) -> &str {
    &s[..end_byte_at_unit(s, units)]
}

/// Longest suffix of `s` taking at most `units` UTF-16 code units.
pub fn suffix_units(s: &str, units: usize) -> &str {
    let total = len_units(s);
    let start = total.saturating_sub(units);
    &s[start_byte_at_unit(s, start)..]
}

/// Up to `units` UTF-16 code units starting at the 0-based code-unit
/// offset `start` (see module docs for boundary rounding).
pub fn mid_units(s: &str, start: usize, units: usize) -> &str {
    if start >= len_units(s) {
        return "";
    }
    let b0 = start_byte_at_unit(s, start);
    let b1 = end_byte_at_unit(s, start.saturating_add(units));
    &s[b0..b1.max(b0)]
}

/// 0-based UTF-16 code-unit offset of `byte` (a `str::find` result) in
/// `s`. Callers add 1 for Excel's 1-based positions.
pub fn unit_offset_of_byte(s: &str, byte: usize) -> usize {
    len_units(&s[..byte])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn len_ascii() {
        assert_eq!(len_units("hello"), 5);
    }

    #[test]
    fn len_non_bmp_counts_two() {
        assert_eq!(len_units("😀x"), 3);
        assert_eq!(len_units("é"), 1);
        assert_eq!(len_units("e\u{301}"), 2); // e + combining accent
    }

    #[test]
    fn prefix_rounds_up_to_char_boundary() {
        assert_eq!(prefix_units("😀x", 1), "😀");
        assert_eq!(prefix_units("😀x", 2), "😀");
        assert_eq!(prefix_units("😀x", 3), "😀x");
        assert_eq!(prefix_units("abc", 2), "ab");
    }

    #[test]
    fn suffix_units_counts_from_end() {
        assert_eq!(suffix_units("abc", 2), "bc");
        assert_eq!(suffix_units("x😀", 2), "😀");
        assert_eq!(suffix_units("x😀", 1), "😀");
        assert_eq!(suffix_units("abc", 9), "abc");
    }

    #[test]
    fn mid_units_basic() {
        assert_eq!(mid_units("abcdef", 1, 3), "bcd");
        assert_eq!(mid_units("abc", 5, 2), "");
        assert_eq!(mid_units("abc", 1, 99), "bc");
    }

    #[test]
    fn mid_units_non_bmp() {
        assert_eq!(mid_units("😀x", 0, 1), "😀");
        assert_eq!(mid_units("😀x", 2, 1), "x");
        assert_eq!(mid_units("😀x", 1, 1), "😀"); // inside pair: start rounds down
    }
}
