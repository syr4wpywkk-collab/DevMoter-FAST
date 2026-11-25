//! Comparison semantics (v2 §3) — **no code yet**.
//!
//! Intended role: the single ordering/equality relation for criteria,
//! `MATCH`/`XLOOKUP`/`LOOKUP` and `SORT` — Excel's type order
//! (number < text < boolean), case-insensitive text equality, and
//! blank-vs-zero handling, shared so functions never hand-roll
//! comparisons.

use calc_core::value::{Value, round_15};
use std::cmp::Ordering;

/// Scalar equality matching the `=` operator's rules (used by `SWITCH`):
/// numbers at 15 significant digits, text case-insensitively, booleans strictly, blanks
/// equal to blanks; different kinds are never equal. Mirrors
/// `eval::compare_values`'s equality half.
pub fn scalar_eq(l: &Value, r: &Value) -> bool {
    use Value::*;
    match (l, r) {
        // Same 15-digit equality as the `=` operator.
        (Number(a), Number(b)) => round_15(*a) == round_15(*b),
        (Text(a), Text(b)) => a.eq_ignore_ascii_case(b),
        (Boolean(a), Boolean(b)) => a == b,
        (Blank, Blank) => true,
        // Excel treats blank as 0 against numbers / "" against text.
        (Blank, Number(b)) | (Number(b), Blank) => round_15(*b) == 0.0,
        (Blank, Text(b)) | (Text(b), Blank) => b.is_empty(),
        _ => false,
    }
}

/// Type rank for SORT's key ordering (v2 `docs/functions/SORT.md`):
/// numbers < text < booleans < errors; blanks always last. Array
/// values cannot appear as sort keys; ranked last defensively.
fn sort_rank(v: &Value) -> u8 {
    match v {
        Value::Number(_) => 0,
        Value::Text(_) => 1,
        Value::Boolean(_) => 2,
        Value::Error(_) => 3,
        Value::Blank => 4,
        Value::Array(_) | Value::Lambda(_) | Value::Reference(_) => 5,
    }
}

/// Ascending key comparison for `SORT`: numbers numerically, text
/// case-insensitively with a code-point tie-break, booleans
/// FALSE < TRUE, errors by code; differing kinds order by
/// [`sort_rank`], so blanks always sort last.
pub fn sort_cmp(l: &Value, r: &Value) -> Ordering {
    match (l, r) {
        (Value::Number(a), Value::Number(b)) => a.partial_cmp(b).unwrap_or(Ordering::Equal),
        (Value::Text(a), Value::Text(b)) => a
            .to_ascii_lowercase()
            .cmp(&b.to_ascii_lowercase())
            .then_with(|| a.cmp(b)),
        (Value::Boolean(a), Value::Boolean(b)) => a.cmp(b),
        (Value::Error(a), Value::Error(b)) => a.code().cmp(b.code()),
        _ => sort_rank(l).cmp(&sort_rank(r)),
    }
}

/// `SORT` key comparison honoring `descending`: non-blank keys flip,
/// but blanks stay last in *both* directions (Excel behavior).
pub fn sort_cmp_dir(l: &Value, r: &Value, descending: bool) -> Ordering {
    if l.is_blank() || r.is_blank() {
        return sort_rank(l).cmp(&sort_rank(r));
    }
    if descending {
        sort_cmp(r, l)
    } else {
        sort_cmp(l, r)
    }
}
