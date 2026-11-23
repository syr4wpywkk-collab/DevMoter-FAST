//! Byte-oriented text indexing (v3 `*B` functions): the DBCS byte-width
//! model shared by `FINDB`/`LEFTB`/`LENB`/`MIDB`/`REPLACEB`/`RIGHTB`/
//! `SEARCHB`. Spec docs: `docs/functions/FINDB.md`, `RIGHTB.md`, etc.
//!
//! # Byte-width model (SPEC-OPEN)
//!
//! Excel's `*B` functions count bytes in a DBCS codepage (CP932-style):
//! every double-byte character contributes 2, every single-byte
//! character 1. The spec docs leave the concrete model open (CP932
//! bytes vs UTF-16 units vs East-Asian width). This module adopts an
//! **East-Asian wide/fullwidth model**: characters in the classic
//! double-byte ranges (CJK ideographs, Hiragana, Katakana, Hangul,
//! fullwidth forms, CJK punctuation — including supplementary-plane CJK)
//! count 2; every other character counts 1. That makes ASCII text behave
//! exactly like the non-`*B` variants, matching Excel's non-DBCS
//! degradation, and gives the spec docs' `東京都`-style examples their
//! documented byte counts. Noncharacters/emoji outside those ranges
//! count 1 even though some codepages would store them wider — fixtures
//! exercising that are `specOpen`.
//!
//! # Boundary rule (SPEC-OPEN)
//!
//! When a byte position cuts through a double-byte character:
//!
//! - *Take* boundaries (`RIGHTB`/`LEFTB`/`MIDB` style prefix/suffix
//!   slices) drop the partial character — the result contains only
//!   whole characters.
//! - *Start* boundaries (`SEARCHB`'s `start_num`, `REPLACEB`'s replace
//!   start) round **forward** to the next whole character — positions
//!   address characters, never half of one.
//! - *Removal* boundaries (`REPLACEB`'s `num_bytes` range) expand to
//!   cover every character the byte range touches — a cut character is
//!   removed whole, per the spec doc's expectation.

/// Width of `c` in the adopted DBCS model: 2 for double-byte ranges,
/// 1 otherwise.
pub fn byte_width(c: char) -> usize {
    let u = c as u32;
    let wide = matches!(u,
        0x1100..=0x115F            // Hangul Jamo
        | 0x2E80..=0x303E          // CJK Radicals Supplement, Kangxi, IDCs, CJK Symbols
        | 0x3041..=0x33FF          // Hiragana, Katakana, Bopomofo, CJK Strokes/Ext
        | 0x3400..=0x4DBF          // CJK Unified Ideographs Extension A
        | 0x4E00..=0x9FFF          // CJK Unified Ideographs
        | 0xA000..=0xA4CF          // Yi
        | 0xAC00..=0xD7A3          // Hangul Syllables
        | 0xF900..=0xFAFF          // CJK Compatibility Ideographs
        | 0xFE30..=0xFE6F          // CJK Compatibility Forms
        | 0xFF00..=0xFF60          // Fullwidth Forms
        | 0xFFE0..=0xFFE6          // Fullwidth signs
        | 0x1B000..=0x1B16F        // Kana Supplement
        | 0x1F200..=0x1F2FF        // Enclosed Ideographic Supplement
        | 0x20000..=0x3FFFF        // CJK Extension B and beyond
    );
    if wide { 2 } else { 1 }
}

/// Length of `s` in DBCS bytes (`LENB`'s counting unit).
pub fn len_bytes(s: &str) -> usize {
    s.chars().map(byte_width).sum()
}

/// Byte-unit offset (0-based) of char index `ci` in `s` — the sum of the
/// widths of the characters before it. `ci` beyond the end clamps to the
/// total byte length.
pub fn byte_pos_of_char(s: &str, ci: usize) -> usize {
    s.chars().take(ci).map(byte_width).sum()
}

/// Longest prefix of `s` occupying at most `budget` bytes; a partial
/// trailing double-byte character is dropped (take boundary).
pub fn prefix_bytes(s: &str, budget: usize) -> &str {
    if budget == 0 {
        return "";
    }
    let mut acc = 0usize;
    for (b, c) in s.char_indices() {
        acc += byte_width(c);
        if acc > budget {
            return &s[..b];
        }
    }
    s
}

/// Longest suffix of `s` occupying at most `budget` bytes; a partial
/// leading double-byte character is dropped (take boundary).
pub fn suffix_bytes(s: &str, budget: usize) -> &str {
    let total = len_bytes(s);
    if budget >= total {
        return s;
    }
    let skip = total - budget;
    // A start boundary landing inside a wide char rounds forward to the
    // next character, so the partial char is dropped.
    let mut acc = 0usize;
    for (b, c) in s.char_indices() {
        if acc >= skip {
            return &s[b..];
        }
        acc += byte_width(c);
    }
    ""
}

/// Char index and leading-edge byte offset for byte offset `pos`
/// (0-based): if `pos` falls on a character boundary, returns
/// `(char_index, pos)`; if it falls inside a double-byte character,
/// rounds forward to the next character (start boundary).
/// `pos` past the end returns `(chars.len(), len_bytes(s))`.
pub fn char_index_at_byte(s: &str, pos: usize) -> (usize, usize) {
    let mut acc = 0usize;
    for (ci, c) in s.chars().enumerate() {
        let w = byte_width(c);
        if acc >= pos {
            return (ci, acc);
        }
        if acc + w > pos {
            // `pos` inside `c` (only possible when w == 2): round forward.
            return (ci + 1, acc + w);
        }
        acc += w;
    }
    (s.chars().count(), acc)
}

/// Byte offset in the UTF-8 string of char index `ci`.
fn utf8_of_char(s: &str, ci: usize) -> usize {
    s.char_indices().nth(ci).map(|(b, _)| b).unwrap_or(s.len())
}

/// Remove the byte range `[start_byte0, start_byte0 + num_bytes)`
/// (0-based, DBCS units) expanded to whole characters, and return the
/// `(head, tail)` UTF-8 slices around it (`REPLACEB`'s core).
pub fn remove_byte_range(s: &str, start_byte0: usize, num_bytes: usize) -> (&str, &str) {
    let total = len_bytes(s);
    if start_byte0 >= total {
        return (s, "");
    }
    // Expand the removal range to cover whole characters: the start
    // boundary rounds back so a cut char is removed whole.
    let mut head_end = 0usize; // char index where removal begins
    let mut acc = 0usize;
    for (ci, c) in s.chars().enumerate() {
        if acc + byte_width(c) > start_byte0 {
            head_end = ci;
            break;
        }
        acc += byte_width(c);
        head_end = ci + 1;
    }
    let end_byte = start_byte0.saturating_add(num_bytes).min(total);
    let (mut tail_start, _) = char_index_at_byte(s, end_byte);
    if tail_start < head_end {
        tail_start = head_end;
    }
    (
        &s[..utf8_of_char(s, head_end)],
        &s[utf8_of_char(s, tail_start)..],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn width_model() {
        assert_eq!(byte_width('a'), 1);
        assert_eq!(byte_width('é'), 1);
        assert_eq!(byte_width('東'), 2);
        assert_eq!(byte_width('あ'), 2);
        assert_eq!(byte_width('한'), 2);
        assert_eq!(byte_width('Ａ'), 2); // fullwidth
        assert_eq!(byte_width('ｱ'), 1); // halfwidth katakana: single-byte in CP932
        assert_eq!(byte_width('😀'), 1); // not a DBCS range (SPEC-OPEN)
    }

    #[test]
    fn len_bytes_counts() {
        assert_eq!(len_bytes("abc"), 3);
        assert_eq!(len_bytes("東京都"), 6);
        assert_eq!(len_bytes("a東b"), 4);
    }

    #[test]
    fn prefix_drops_partial() {
        assert_eq!(prefix_bytes("東京都", 4), "東京");
        assert_eq!(prefix_bytes("東京都", 3), "東");
        assert_eq!(prefix_bytes("東京都", 0), "");
        assert_eq!(prefix_bytes("abc", 9), "abc");
    }

    #[test]
    fn suffix_drops_partial() {
        assert_eq!(suffix_bytes("東京都", 4), "京都");
        assert_eq!(suffix_bytes("東京都", 3), "都");
        assert_eq!(suffix_bytes("東京都", 6), "東京都");
        assert_eq!(suffix_bytes("abc", 2), "bc");
    }

    #[test]
    fn byte_pos_of_char_sums_widths() {
        assert_eq!(byte_pos_of_char("東京都", 0), 0);
        assert_eq!(byte_pos_of_char("東京都", 1), 2);
        assert_eq!(byte_pos_of_char("東京都", 3), 6);
        assert_eq!(byte_pos_of_char("a東b", 2), 3);
    }

    #[test]
    fn char_index_at_byte_rounds_forward() {
        assert_eq!(char_index_at_byte("東京都", 0), (0, 0));
        assert_eq!(char_index_at_byte("東京都", 1), (1, 2)); // inside 東
        assert_eq!(char_index_at_byte("東京都", 2), (1, 2));
        assert_eq!(char_index_at_byte("東京都", 99), (3, 6));
    }

    #[test]
    fn remove_byte_range_whole_chars() {
        assert_eq!(remove_byte_range("東京都", 2, 2), ("東", "都"));
        // Byte range 1..3 cuts 東 (0..2) and 京 (2..4): both removed whole.
        assert_eq!(remove_byte_range("東京都", 1, 2), ("", "都"));
        assert_eq!(remove_byte_range("abcdef", 1, 3), ("a", "ef"));
        assert_eq!(remove_byte_range("abc", 5, 1), ("abc", ""));
        assert_eq!(remove_byte_range("abc", 0, 0), ("", "abc"));
    }
}
