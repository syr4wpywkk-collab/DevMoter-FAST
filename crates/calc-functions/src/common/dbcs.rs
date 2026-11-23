//! DBCS emulation layer (v3): the shared byte-width model for the
//! `*B` text functions (`FINDB`/`LEFTB`/`LENB`/`MIDB`) and the
//! full-width/half-width conversion tables for `ASC`/`DBCS`.
//!
//! # Byte-width model (SPEC-OPEN)
//!
//! The spec docs (`docs/functions/FINDB.md`) leave the reference byte
//! model open (CP932 bytes vs UTF-16 units vs East-Asian width). This
//! engine adopts a fixed CP932-faithful approximation:
//!
//! - ASCII (`U+0000..=U+007F`) and half-width katakana
//!   (`U+FF61..=U+FF9F`, single-byte in CP932) count **1**;
//! - every other character counts **2**.
//!
//! In CP932, Latin-1 letters and all CJK ideographs are indeed
//! double-byte, while characters unrepresentable in CP932 (e.g. emoji)
//! fall back to this module's uniform width of 2 — fixtures exercising
//! characters outside CP932 are marked `specOpen`.
//!
//! A double-byte character is never split: end boundaries drop the
//! partial character (`LEFTB("東",1)` -> `""`), and start boundaries
//! snap forward to the next whole character.

/// DBCS byte width of `c` under the model described in the module docs.
pub fn char_width(c: char) -> usize {
    if c.is_ascii() || ('\u{FF61}'..='\u{FF9F}').contains(&c) {
        1
    } else {
        2
    }
}

/// Byte length of `s` under the DBCS model (`LENB` semantics).
pub fn len_bytes(s: &str) -> usize {
    s.chars().map(char_width).sum()
}

/// Longest prefix of `s` whose byte width is at most `bytes`; a
/// double-byte character at the boundary is dropped whole.
pub fn prefix_bytes(s: &str, bytes: usize) -> &str {
    let mut acc = 0usize;
    for (b, c) in s.char_indices() {
        if acc + char_width(c) > bytes {
            return &s[..b];
        }
        acc += char_width(c);
    }
    s
}

/// UTF-8 byte index of the first character whose DBCS byte offset is
/// `>= pos`; a `pos` inside a double-byte character snaps forward to
/// the next character boundary.
pub fn byte_index_at(s: &str, pos: usize) -> usize {
    let mut acc = 0usize;
    for (b, c) in s.char_indices() {
        if acc >= pos {
            return b;
        }
        acc += char_width(c);
    }
    s.len()
}

/// Up to `bytes` DBCS bytes starting at 0-based byte offset `start0`
/// (`MIDB` semantics): the start snaps forward to a character
/// boundary and a trailing partial character is dropped.
pub fn mid_bytes(s: &str, start0: usize, bytes: usize) -> &str {
    if start0 >= len_bytes(s) {
        return "";
    }
    let b0 = byte_index_at(s, start0);
    prefix_bytes(&s[b0..], bytes)
}

// ---------- full-width / half-width conversion (ASC / DBCS) ----------

/// Half-width katakana `U+FF61..=U+FF9F` in code order.
const HW_KANA: &str = "｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ";

/// Full-width forms of [`HW_KANA`], same index order.
const FW_KANA: &str = "。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜";

/// Full-width dakuten-voiced katakana built from `VOICED_BASE` + `゛`.
const VOICED_FULL: &str = "ガギグゲゴザジズゼゾダヂヅデドバビブベボヴ";
const VOICED_BASE: &str = "カキクケコサシスセソタチツテトハヒフヘホウ";

/// Full-width handakuten katakana built from `HANDAK_BASE` + `゜`.
const HANDAK_FULL: &str = "パピプペポ";
const HANDAK_BASE: &str = "ハヒフヘホ";

fn hw_kana() -> impl Iterator<Item = char> {
    HW_KANA.chars()
}
fn fw_kana() -> impl Iterator<Item = char> {
    FW_KANA.chars()
}

/// Full-width form of a half-width katakana char (or `None`).
fn kana_to_full(c: char) -> Option<char> {
    hw_kana()
        .zip(fw_kana())
        .find(|(h, _)| *h == c)
        .map(|(_, f)| f)
}

/// Half-width form of a full-width katakana char (or `None`).
fn kana_to_half(c: char) -> Option<char> {
    hw_kana()
        .zip(fw_kana())
        .find(|(_, f)| *f == c)
        .map(|(h, _)| h)
}

/// If `base` (full-width) voiced with `mark` (`゛`/`゜`) forms a
/// precomposed katakana, return it.
fn compose_voiced(base: char, mark: char) -> Option<char> {
    match mark {
        '゛' => VOICED_BASE
            .chars()
            .zip(VOICED_FULL.chars())
            .find(|(b, _)| *b == base)
            .map(|(_, v)| v),
        '゜' => HANDAK_BASE
            .chars()
            .zip(HANDAK_FULL.chars())
            .find(|(b, _)| *b == base)
            .map(|(_, v)| v),
        _ => None,
    }
}

/// Half-width decomposition of a voiced/semi-voiced full-width
/// katakana: `(base_halfwidth, mark_halfwidth)`.
fn decompose_voiced(c: char) -> Option<(char, char)> {
    if let Some((b, _)) = VOICED_BASE
        .chars()
        .zip(VOICED_FULL.chars())
        .find(|(_, v)| *v == c)
    {
        return Some((kana_to_half(b).unwrap(), 'ﾞ'));
    }
    HANDAK_BASE
        .chars()
        .zip(HANDAK_FULL.chars())
        .find(|(_, v)| *v == c)
        .map(|(b, _)| (kana_to_half(b).unwrap(), 'ﾟ'))
}

/// `ASC` semantics: full-width ASCII variants, the full-width space,
/// and full-width katakana map to their half-width forms (voiced
/// kana decompose to base + `ﾞ`/`ﾟ`). Everything else is unchanged.
pub fn to_halfwidth(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\u{3000}' => out.push(' '),
            '\u{FF01}'..='\u{FF5E}' => out.push(char::from_u32(c as u32 - 0xFEE0).unwrap()),
            _ => {
                if let Some((b, m)) = decompose_voiced(c) {
                    out.push(b);
                    out.push(m);
                } else if let Some(h) = kana_to_half(c) {
                    out.push(h);
                } else {
                    out.push(c);
                }
            }
        }
    }
    out
}

/// `DBCS` semantics: half-width ASCII, the ASCII space, and
/// half-width katakana map to their full-width forms; a
/// `ﾞ`/`ﾟ` immediately after a katakana composes into the
/// voiced/semi-voiced character. Everything else is unchanged.
pub fn to_fullwidth(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            ' ' => out.push('\u{3000}'),
            '\u{21}'..='\u{7E}' => out.push(char::from_u32(c as u32 + 0xFEE0).unwrap()),
            _ => {
                if let Some(f) = kana_to_full(c) {
                    // Try to compose with a following half-width
                    // dakuten/handakuten mark (SPEC-OPEN: exact
                    // composition rules vs a reference locale).
                    if let Some(&m @ ('ﾞ' | 'ﾟ')) = chars.peek() {
                        let mark = if m == 'ﾞ' { '゛' } else { '゜' };
                        if let Some(v) = compose_voiced(f, mark) {
                            chars.next();
                            out.push(v);
                            continue;
                        }
                    }
                    out.push(f);
                } else {
                    out.push(c);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widths() {
        assert_eq!(char_width('a'), 1);
        assert_eq!(char_width('東'), 2);
        assert_eq!(char_width('ｶ'), 1); // half-width katakana is single-byte in CP932
        assert_eq!(char_width('é'), 2); // double-byte under CP932
    }

    #[test]
    fn len_bytes_counts() {
        assert_eq!(len_bytes("東京都"), 6);
        assert_eq!(len_bytes("abc"), 3);
        assert_eq!(len_bytes("a東"), 3);
        assert_eq!(len_bytes(""), 0);
    }

    #[test]
    fn prefix_drops_partial_char() {
        assert_eq!(prefix_bytes("東京都", 4), "東京");
        assert_eq!(prefix_bytes("東京都", 3), "東");
        assert_eq!(prefix_bytes("東", 1), "");
        assert_eq!(prefix_bytes("abc", 2), "ab");
    }

    #[test]
    fn mid_snaps_start_forward() {
        assert_eq!(mid_bytes("東京都", 2, 2), "京");
        assert_eq!(mid_bytes("東京都", 0, 4), "東京");
        assert_eq!(mid_bytes("abc", 1, 3), "bc");
        assert_eq!(mid_bytes("abc", 3, 1), "");
    }

    #[test]
    fn ascii_and_space_round_trip() {
        assert_eq!(to_fullwidth("ABC 123"), "ＡＢＣ　１２３");
        assert_eq!(to_halfwidth("ＡＢＣ　１２３"), "ABC 123");
    }

    #[test]
    fn katakana_round_trip() {
        assert_eq!(to_fullwidth("ｶﾀｶﾅ"), "カタカナ");
        assert_eq!(to_halfwidth("カタカナ"), "ｶﾀｶﾅ");
    }

    #[test]
    fn voiced_katakana() {
        assert_eq!(to_fullwidth("ｶﾞ"), "ガ");
        assert_eq!(to_fullwidth("ﾊﾟ"), "パ");
        assert_eq!(to_halfwidth("ガ"), "ｶﾞ");
        assert_eq!(to_halfwidth("パ"), "ﾊﾟ");
    }

    #[test]
    fn passthrough() {
        assert_eq!(to_halfwidth("abc"), "abc");
        assert_eq!(to_fullwidth("ＡＢＣ"), "ＡＢＣ");
        assert_eq!(to_halfwidth("東"), "東");
    }
}
