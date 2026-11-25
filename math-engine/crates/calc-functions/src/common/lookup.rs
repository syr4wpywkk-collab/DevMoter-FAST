//! Lookup matching (v2 §3): the shared search layer for `MATCH`,
//! `XLOOKUP`, `VLOOKUP`, `HLOOKUP` and `LOOKUP`.
//!
//! Owns three things so the function files never re-implement them:
//!
//! - [`compare`]: Excel's cross-type ordering for lookup keys
//!   (number < text < boolean), case-insensitive text, blank-as-zero.
//! - [`exact_eq`] / [`wildcard_match`]: type-strict equality plus the
//!   `*`/`?`/`~` wildcard grammar shared with the criteria functions.
//! - [`approx_asc`] / [`approx_desc`]: binary searches over vectors
//!   *assumed sorted* (Excel semantics for `match_type` ±1 and the
//!   `LOOKUP` family). Results on unsorted input are deterministic but
//!   unspecified — matching Excel's quirk-for-quirk is SPEC-OPEN.
//!
//! Error values inside a searched vector never match and compare
//! "highest" during binary search; a non-matching error element is
//! skipped rather than propagated (SPEC-OPEN: Excel's exact behavior
//! with error cells mid-vector is unconfirmed).

use calc_core::error::CalcError;
use calc_core::value::Value;
use std::cmp::Ordering;

/// Excel's cross-type rank used by lookup comparisons:
/// numbers (and blanks-as-zero) < text < booleans < everything else.
fn type_rank(v: &Value) -> u8 {
    match v {
        Value::Number(_) | Value::Blank => 0,
        Value::Text(_) => 1,
        Value::Boolean(_) => 2,
        Value::Error(_) | Value::Array(_) | Value::Lambda(_) | Value::Reference(_) => 3,
    }
}

/// Order two values the way Excel lookup functions compare keys.
///
/// Mirrors the evaluator's scalar comparison: `Blank` counts as `0`
/// against numbers and as `""` against text; differing types fall back
/// to the rank order. Errors and arrays rank above everything.
pub fn compare(a: &Value, b: &Value) -> Ordering {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.partial_cmp(y).unwrap_or(Ordering::Equal),
        (Value::Text(x), Value::Text(y)) => x.to_ascii_lowercase().cmp(&y.to_ascii_lowercase()),
        (Value::Boolean(x), Value::Boolean(y)) => x.cmp(y),
        (Value::Blank, Value::Blank) => Ordering::Equal,
        (Value::Blank, Value::Number(y)) => 0.0f64.partial_cmp(y).unwrap_or(Ordering::Equal),
        (Value::Number(x), Value::Blank) => x.partial_cmp(&0.0).unwrap_or(Ordering::Equal),
        (Value::Blank, Value::Text(y)) => "".cmp(y.to_ascii_lowercase().as_str()),
        (Value::Text(x), Value::Blank) => x.to_ascii_lowercase().as_str().cmp(""),
        _ => type_rank(a).cmp(&type_rank(b)),
    }
}

/// Type-strict equality for exact match: numbers by value, text
/// case-insensitively, booleans by value, blank matches blank only.
/// Cross-type pairs (number `1` vs text `"1"`) never match.
pub fn exact_eq(needle: &Value, cell: &Value) -> bool {
    match (needle, cell) {
        (Value::Number(a), Value::Number(b)) => a == b,
        (Value::Text(a), Value::Text(b)) => a.eq_ignore_ascii_case(b),
        (Value::Boolean(a), Value::Boolean(b)) => a == b,
        (Value::Blank, Value::Blank) => true,
        _ => false,
    }
}

/// `true` when `needle` contains wildcard characters (`*`/`?`, with `~`
/// escaping the next character literally).
pub fn has_wildcards(needle: &str) -> bool {
    let mut chars = needle.chars();
    while let Some(c) = chars.next() {
        match c {
            '*' | '?' => return true,
            '~' => {
                chars.next();
            }
            _ => {}
        }
    }
    false
}

/// Case-insensitive wildcard match (`*` = any run, `?` = one char,
/// `~*`/`~?`/`~~` = literals). Recursive with an explicit step bound via
/// the monotonically shrinking pattern — no backtracking blowup on
/// realistic patterns.
pub fn wildcard_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    wild_rec(&p, 0, &t, 0)
}

fn wild_rec(p: &[char], mut pi: usize, t: &[char], mut ti: usize) -> bool {
    loop {
        match p.get(pi) {
            None => return ti == t.len(),
            Some('*') => {
                // Collapse consecutive `*`.
                let mut q = pi + 1;
                while p.get(q) == Some(&'*') {
                    q += 1;
                }
                // Try to match the remainder at every text position.
                for k in ti..=t.len() {
                    if wild_rec(p, q, t, k) {
                        return true;
                    }
                }
                return false;
            }
            Some('?') => {
                if ti >= t.len() {
                    return false;
                }
                pi += 1;
                ti += 1;
            }
            Some('~') => {
                match p.get(pi + 1) {
                    Some(&c) if c == '*' || c == '?' || c == '~' => {
                        if t.get(ti)
                            .map(|&tc| !tc.eq_ignore_ascii_case(&c))
                            .unwrap_or(true)
                        {
                            return false;
                        }
                        pi += 2;
                        ti += 1;
                    }
                    // Lone trailing `~` or `~` before a normal char: Excel
                    // treats `~` literally only before * ? ~; before other
                    // chars the tilde is dropped (SPEC-OPEN, confirmed
                    // behavior: `~x` matches `~x`? — we match `x`).
                    Some(_) => {
                        pi += 1;
                    }
                    None => return false,
                }
            }
            Some(&c) => {
                if t.get(ti)
                    .map(|&tc| !tc.eq_ignore_ascii_case(&c))
                    .unwrap_or(true)
                {
                    return false;
                }
                pi += 1;
                ti += 1;
            }
        }
    }
}

/// Match a single cell against a lookup value for *exact* matching
/// (match_type 0 / XLOOKUP mode 0): type-strict equality, plus wildcard
/// semantics when `wildcards` is set and the needle is text.
pub fn exact_cell_match(needle: &Value, cell: &Value, wildcards: bool) -> bool {
    if cell.is_error() {
        return false; // error cells never match (SPEC-OPEN)
    }
    if let (Value::Text(p), Value::Text(s)) = (needle, cell) {
        if wildcards && has_wildcards(p) {
            return wildcard_match(p, s);
        }
    }
    exact_eq(needle, cell)
}

/// Position (0-based index) of `needle` in `cells` under exact match,
/// scanning in index order. `rev` scans last-to-first (XLOOKUP
/// `search_mode -1`). Returns `None` when nothing matches.
pub fn exact_position(
    cells: &[Value],
    needle: &Value,
    wildcards: bool,
    rev: bool,
) -> Option<usize> {
    let range: Vec<usize> = if rev {
        (0..cells.len()).rev().collect()
    } else {
        (0..cells.len()).collect()
    };
    range
        .into_iter()
        .find(|&i| exact_cell_match(needle, &cells[i], wildcards))
}

/// Binary search over a vector *assumed sorted ascending*: returns the
/// 0-based index of the largest element `<= needle`, or `None` when the
/// needle is smaller than every element. Deterministic but unspecified
/// on unsorted input (SPEC-OPEN vs Excel's own binary-search quirks).
pub fn approx_asc(cells: &[Value], needle: &Value) -> Option<usize> {
    let mut lo = 0usize;
    let mut hi = cells.len();
    let mut best: Option<usize> = None;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        match compare(&cells[mid], needle) {
            Ordering::Less | Ordering::Equal => {
                best = Some(mid);
                lo = mid + 1;
            }
            Ordering::Greater => hi = mid,
        }
    }
    best
}

/// Binary search over a vector *assumed sorted descending*: returns the
/// 0-based index of the smallest element `>= needle`, or `None`. Same
/// unsorted-input caveat as [`approx_asc`].
pub fn approx_desc(cells: &[Value], needle: &Value) -> Option<usize> {
    let mut lo = 0usize;
    let mut hi = cells.len();
    let mut best: Option<usize> = None;
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        match compare(&cells[mid], needle) {
            Ordering::Greater | Ordering::Equal => {
                best = Some(mid);
                lo = mid + 1;
            }
            Ordering::Less => hi = mid,
        }
    }
    best
}

/// Lower bound over a vector *assumed sorted ascending*: the 0-based
/// index of the smallest element `>= needle` (`None` when the needle is
/// larger than every element). Complement of [`approx_asc`] for
/// XLOOKUP's next-larger binary mode.
pub fn approx_asc_ge(cells: &[Value], needle: &Value) -> Option<usize> {
    let mut lo = 0usize;
    let mut hi = cells.len();
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        match compare(&cells[mid], needle) {
            Ordering::Less => lo = mid + 1,
            _ => hi = mid,
        }
    }
    (lo < cells.len()).then_some(lo)
}

/// Mirror of [`approx_asc_ge`] over a vector *assumed sorted
/// descending*: the index of the largest element `<= needle`.
pub fn approx_desc_le(cells: &[Value], needle: &Value) -> Option<usize> {
    let mut lo = 0usize;
    let mut hi = cells.len();
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        match compare(&cells[mid], needle) {
            Ordering::Greater => lo = mid + 1,
            _ => hi = mid,
        }
    }
    (lo < cells.len()).then_some(lo)
}

/// Linear scan for XLOOKUP's approximate modes on (possibly unsorted)
/// data: `next_smaller` returns the largest element strictly below
/// `needle`; `next_larger` the smallest strictly above. Exact hits are
/// handled by the caller first.
pub fn nearest(cells: &[Value], needle: &Value, next_smaller: bool) -> Option<usize> {
    let mut best: Option<usize> = None;
    for (i, cell) in cells.iter().enumerate() {
        if cell.is_error() {
            continue;
        }
        let ord = compare(cell, needle);
        let candidate = if next_smaller {
            ord == Ordering::Less
        } else {
            ord == Ordering::Greater
        };
        if candidate {
            let better = match best {
                None => true,
                Some(b) => {
                    let bo = compare(cell, &cells[b]);
                    if next_smaller {
                        bo == Ordering::Greater
                    } else {
                        bo == Ordering::Less
                    }
                }
            };
            if better {
                best = Some(i);
            }
        }
    }
    best
}

/// Shared `#N/A`.
pub fn not_found() -> Value {
    Value::Error(CalcError::NA)
}

/// Truncate a coerced `f64` index toward zero into `i64` (shared
/// `row_num`/`col_index`/`index_num` rule).
pub fn index_to_i64(v: &Value) -> Result<i64, CalcError> {
    let n = v.to_number()?;
    if !n.is_finite() {
        return Err(CalcError::Value);
    }
    Ok(n.trunc() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nums(v: &[f64]) -> Vec<Value> {
        v.iter().map(|n| Value::Number(*n)).collect()
    }

    #[test]
    fn compare_type_order() {
        assert_eq!(
            compare(&Value::Number(9.0), &Value::Text("a".into())),
            Ordering::Less
        );
        assert_eq!(
            compare(&Value::Text("a".into()), &Value::Boolean(false)),
            Ordering::Less
        );
        assert_eq!(
            compare(&Value::Boolean(false), &Value::Number(1.0)),
            Ordering::Greater
        );
    }

    #[test]
    fn compare_text_case_insensitive() {
        assert_eq!(
            compare(&Value::Text("Apple".into()), &Value::Text("apple".into())),
            Ordering::Equal
        );
    }

    #[test]
    fn exact_eq_strict_types() {
        assert!(!exact_eq(&Value::Number(1.0), &Value::Text("1".into())));
        assert!(exact_eq(&Value::Text("A".into()), &Value::Text("a".into())));
        assert!(exact_eq(&Value::Blank, &Value::Blank));
        assert!(!exact_eq(&Value::Blank, &Value::Number(0.0)));
    }

    #[test]
    fn wildcards() {
        assert!(wildcard_match("ap*", "apple"));
        assert!(!wildcard_match("a?le", "apple"));
        assert!(wildcard_match("a??le", "apple"));
        assert!(wildcard_match("a~*e", "a*e"));
        assert!(!wildcard_match("a~*e", "axe"));
        assert!(wildcard_match("*", "anything"));
        assert!(!wildcard_match("a*", "ba"));
    }

    #[test]
    fn has_wildcards_escape() {
        assert!(has_wildcards("a*"));
        assert!(!has_wildcards("a~*"));
        assert!(has_wildcards("a~*?"));
    }

    #[test]
    fn approx_asc_sorted() {
        let c = nums(&[1.0, 2.0, 3.0, 4.0]);
        assert_eq!(approx_asc(&c, &Value::Number(2.5)), Some(1));
        assert_eq!(approx_asc(&c, &Value::Number(4.0)), Some(3));
        assert_eq!(approx_asc(&c, &Value::Number(9.0)), Some(3));
        assert_eq!(approx_asc(&c, &Value::Number(0.0)), None);
    }

    #[test]
    fn approx_desc_sorted() {
        let c = nums(&[8.0, 6.0, 4.0, 2.0]);
        assert_eq!(approx_desc(&c, &Value::Number(5.0)), Some(1));
        assert_eq!(approx_desc(&c, &Value::Number(8.0)), Some(0));
        assert_eq!(approx_desc(&c, &Value::Number(1.0)), Some(3));
        assert_eq!(approx_desc(&c, &Value::Number(9.0)), None);
    }

    #[test]
    fn nearest_modes() {
        let c = nums(&[4.0, 1.0, 9.0, 2.0]);
        assert_eq!(nearest(&c, &Value::Number(3.0), true), Some(3));
        assert_eq!(nearest(&c, &Value::Number(3.0), false), Some(0));
        assert_eq!(nearest(&c, &Value::Number(0.5), true), None);
        assert_eq!(nearest(&c, &Value::Number(9.5), false), None);
    }

    #[test]
    fn error_cells_never_match() {
        let c = vec![Value::Error(CalcError::DivZero), Value::Number(2.0)];
        assert_eq!(
            exact_position(&c, &Value::Error(CalcError::DivZero), false, false),
            None
        );
        assert_eq!(
            exact_position(&c, &Value::Number(2.0), false, false),
            Some(1)
        );
    }
}
