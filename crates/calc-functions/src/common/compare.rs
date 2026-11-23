//! Comparison semantics (v2 §3) — **no code yet**.
//!
//! Intended role: the single ordering/equality relation for criteria,
//! `MATCH`/`XLOOKUP`/`LOOKUP` and `SORT` — Excel's type order
//! (number < text < boolean), case-insensitive text equality, and
//! blank-vs-zero handling, shared so functions never hand-roll
//! comparisons.

use calc_core::value::Value;

/// Scalar equality matching the `=` operator's rules (used by `SWITCH`):
/// numbers by value, text case-insensitively, booleans strictly, blanks
/// equal to blanks; different kinds are never equal. Mirrors
/// `eval::compare_values`'s equality half.
pub fn scalar_eq(l: &Value, r: &Value) -> bool {
    use Value::*;
    match (l, r) {
        (Number(a), Number(b)) => a == b,
        (Text(a), Text(b)) => a.eq_ignore_ascii_case(b),
        (Boolean(a), Boolean(b)) => a == b,
        (Blank, Blank) => true,
        // Excel treats blank as 0 against numbers / "" against text.
        (Blank, Number(b)) | (Number(b), Blank) => *b == 0.0,
        (Blank, Text(b)) | (Text(b), Blank) => b.is_empty(),
        _ => false,
    }
}
