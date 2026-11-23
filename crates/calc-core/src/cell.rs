//! Cell identities and A1-notation reference parsing.
//!
//! Coordinates are 0-based internally (`CellId`, `CellRef`); the A1-notation
//! helpers convert at the API boundary. Supported spellings:
//!
//! - `A1`, `$A$1`, `A$1`, `$A1`
//! - ranges: `A1:B10`, `$A$1:$B$10`
//! - sheet-qualified: `Sheet1!A1`, `'Sales 2026'!A1`, `'O''Brien'!A1`
//!   (address part parsing only — resolving the sheet is the caller's job)
//!
//! Full-column (`A:A`) and full-row (`1:1`) references, R1C1 notation,
//! external workbook references (`[1]Sheet!A1`) and structured table
//! references are intentionally not supported yet and produce explicit
//! errors rather than being silently misparsed.

use std::fmt;

/// Maximum number of rows in a sheet (Excel-compatible grid).
pub const MAX_ROWS: u32 = 1_048_576;
/// Maximum number of columns in a sheet (`XFD`).
pub const MAX_COLS: u32 = 16_384;

/// Internal, 0-based cell identity within a workbook.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CellId {
    /// 0-based sheet index into `Workbook::sheets`.
    pub sheet_id: u32,
    /// 0-based row (`0` is displayed as `1`).
    pub row: u32,
    /// 0-based column (`0` is displayed as `A`).
    pub col: u32,
}

impl CellId {
    pub fn new(sheet_id: u32, row: u32, col: u32) -> Result<CellId, RefParseError> {
        if row >= MAX_ROWS || col >= MAX_COLS {
            return Err(RefParseError::new(RefParseErrorKind::OutOfBounds, 0));
        }
        Ok(CellId { sheet_id, row, col })
    }

    /// A1 notation of this cell's address (no `$`, no sheet qualifier).
    pub fn to_a1(&self) -> String {
        format!("{}{}", col_to_letters(self.col), self.row + 1)
    }
}

/// A parsed cell reference with absolute/relative markers.
///
/// `row`/`col` are 0-based. The `*_abs` flags only control how the reference
/// behaves when a formula is copied/shifted; they do not affect evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CellRef {
    pub row: u32,
    pub col: u32,
    pub row_abs: bool,
    pub col_abs: bool,
}

impl CellRef {
    /// Parse a full string as a single cell reference (`A1`..`$XFD$1048576`).
    pub fn from_a1(s: &str) -> Result<CellRef, RefParseError> {
        let (r, end) = parse_cell_ref(s, 0)?;
        if end != s.len() {
            return Err(RefParseError::new(RefParseErrorKind::TrailingInput, end));
        }
        Ok(r)
    }

    /// A1-notation spelling of this reference, preserving `$` markers.
    pub fn to_a1(&self) -> String {
        let mut s = String::new();
        if self.col_abs {
            s.push('$');
        }
        s.push_str(&col_to_letters(self.col));
        if self.row_abs {
            s.push('$');
        }
        s.push_str(&(self.row + 1).to_string());
        s
    }
}

/// A rectangular range of cells, `start` (top-left as written) to `end`.
///
/// The endpoints are stored as written; use [`RangeRef::normalized`] to get
/// the canonical top-left/bottom-right ordering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RangeRef {
    pub start: CellRef,
    pub end: CellRef,
}

impl RangeRef {
    /// Parse `A1:B10`-style ranges. A single cell parses to a 1×1 range.
    pub fn from_a1(s: &str) -> Result<RangeRef, RefParseError> {
        let (start, pos) = parse_cell_ref(s, 0)?;
        match s.as_bytes().get(pos) {
            None => {
                return Ok(RangeRef { start, end: start });
            }
            Some(b':') => {}
            Some(_) => return Err(RefParseError::new(RefParseErrorKind::TrailingInput, pos)),
        }
        let (end, end_pos) = parse_cell_ref(s, pos + 1)?;
        if end_pos != s.len() {
            return Err(RefParseError::new(
                RefParseErrorKind::TrailingInput,
                end_pos,
            ));
        }
        Ok(RangeRef { start, end })
    }

    /// A range with `start <= end` component-wise (canonical orientation).
    pub fn normalized(&self) -> RangeRef {
        RangeRef {
            start: CellRef {
                row: self.start.row.min(self.end.row),
                col: self.start.col.min(self.end.col),
                row_abs: self.start.row_abs,
                col_abs: self.start.col_abs,
            },
            end: CellRef {
                row: self.start.row.max(self.end.row),
                col: self.start.col.max(self.end.col),
                row_abs: self.end.row_abs,
                col_abs: self.end.col_abs,
            },
        }
    }

    /// True when the endpoints are already in canonical order.
    pub fn is_normalized(&self) -> bool {
        self.start.row <= self.end.row && self.start.col <= self.end.col
    }

    /// Number of rows covered (inclusive).
    pub fn row_count(&self) -> u32 {
        let n = self.normalized();
        n.end.row - n.start.row + 1
    }

    /// Number of columns covered (inclusive).
    pub fn col_count(&self) -> u32 {
        let n = self.normalized();
        n.end.col - n.start.col + 1
    }

    /// Total number of cells covered.
    pub fn cell_count(&self) -> u64 {
        self.row_count() as u64 * self.col_count() as u64
    }

    /// A1-notation spelling, preserving `$` markers and written order.
    pub fn to_a1(&self) -> String {
        format!("{}:{}", self.start.to_a1(), self.end.to_a1())
    }

    /// Does this range contain the 0-based `(row, col)`?
    pub fn contains(&self, row: u32, col: u32) -> bool {
        let n = self.normalized();
        (n.start.row..=n.end.row).contains(&row) && (n.start.col..=n.end.col).contains(&col)
    }
}

/// A reference target after stripping an optional sheet qualifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RefTarget {
    Cell(CellRef),
    Range(RangeRef),
}

/// A cell or range reference, optionally qualified by a sheet name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetQualifiedRef {
    /// Sheet name as written (unquoted/unescaped), or `None` when absent.
    pub sheet: Option<String>,
    pub target: RefTarget,
}

/// Parse a reference that may carry a sheet qualifier:
/// `A1`, `$A$1`, `A1:B10`, `Sheet1!A1`, `'Sales 2026'!$A$1:$B$10`.
///
/// `''` inside a quoted sheet name is unescaped to `'`. An unquoted sheet
/// name may not contain whitespace or operator characters; names needing
/// those must be quoted (same rule as Excel).
///
/// SPEC-OPEN: the exact character set Excel permits in unquoted sheet names
/// (e.g. whether Unicode letters are allowed unquoted) is not fully pinned
/// down; we accept letters/digits/`_`/`.` plus non-ASCII alphanumerics.
pub fn parse_sheet_qualified_ref(s: &str) -> Result<SheetQualifiedRef, RefParseError> {
    let (sheet, rest_offset) = match find_bang_split(s) {
        Some(idx) => {
            let (name_part, _) = s.split_at(idx);
            let name = if name_part.starts_with('\'') {
                parse_quoted_name(name_part).map_err(|e| RefParseError::new(e, 0))?
            } else {
                if name_part.starts_with('[') {
                    return Err(RefParseError::new(
                        RefParseErrorKind::UnsupportedExternalRef,
                        0,
                    ));
                }
                if !is_valid_unquoted_sheet_name(name_part) {
                    return Err(RefParseError::new(RefParseErrorKind::InvalidSheetName, 0));
                }
                name_part.to_string()
            };
            (Some(name), idx + 1)
        }
        None => (None, 0),
    };
    let rest = &s[rest_offset..];
    if rest.is_empty() {
        return Err(RefParseError::new(RefParseErrorKind::Empty, s.len()));
    }
    if rest.starts_with('[') {
        return Err(RefParseError::new(
            RefParseErrorKind::UnsupportedExternalRef,
            rest_offset,
        ));
    }
    let (start, pos) = parse_cell_ref(rest, 0).map_err(|mut e| {
        e.offset += rest_offset;
        e
    })?;
    let target = match rest.as_bytes().get(pos) {
        None => RefTarget::Cell(start),
        Some(b':') => {
            let second = &rest[pos + 1..];
            // A sheet qualifier on the second endpoint (e.g. `S!A1:S!B2`)
            // is rejected as unsupported; Excel accepts it only when both
            // names match (SPEC-OPEN).
            if second.contains('!') {
                return Err(RefParseError::new(
                    RefParseErrorKind::UnsupportedRangeForm,
                    rest_offset + pos + 1,
                ));
            }
            let (end, end_pos) = parse_cell_ref(second, 0).map_err(|mut e| {
                e.offset += rest_offset + pos + 1;
                e
            })?;
            if end_pos != second.len() {
                return Err(RefParseError::new(
                    RefParseErrorKind::TrailingInput,
                    rest_offset + pos + 1 + end_pos,
                ));
            }
            RefTarget::Range(RangeRef { start, end })
        }
        Some(_) => {
            return Err(RefParseError::new(
                RefParseErrorKind::TrailingInput,
                rest_offset + pos,
            ));
        }
    };
    Ok(SheetQualifiedRef { sheet, target })
}

/// Locate the `!` separating a sheet qualifier from the address, skipping
/// over `!` characters that appear inside a quoted `'...'` name or a
/// double-quoted string. Returns the byte index of the top-level `!`.
fn find_bang_split(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut i = 0;
    let mut in_single = false;
    let mut in_double = false;
    while i < bytes.len() {
        match bytes[i] {
            b'\'' if !in_double => {
                if in_single && bytes.get(i + 1) == Some(&b'\'') {
                    i += 1; // escaped quote inside quoted name
                } else {
                    in_single = !in_single;
                }
            }
            b'"' if !in_single => in_double = !in_double,
            b'!' if !in_single && !in_double => return Some(i),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Parse `'...'` (with `''` escape) at position 0; must consume the whole
/// string. Returns the unescaped name.
fn parse_quoted_name(s: &str) -> Result<String, RefParseErrorKind> {
    debug_assert!(s.starts_with('\''));
    let mut out = String::new();
    let mut chars = s.char_indices().skip(1).peekable();
    let mut closed = false;
    while let Some((_, c)) = chars.next() {
        if c == '\'' {
            if chars.peek().map(|(_, c2)| *c2) == Some('\'') {
                chars.next();
                out.push('\'');
            } else {
                closed = true;
                break;
            }
        } else {
            out.push(c);
        }
    }
    if !closed {
        return Err(RefParseErrorKind::UnterminatedQuote);
    }
    // Anything after the closing quote would have been caught by the caller
    // (the `!` split), so reaching here means well-formed.
    if chars.next().is_some() {
        return Err(RefParseErrorKind::InvalidSheetName);
    }
    if out.is_empty() {
        return Err(RefParseErrorKind::InvalidSheetName);
    }
    Ok(out)
}

/// Characters forbidden anywhere in a sheet name, per Excel.
const FORBIDDEN_SHEET_CHARS: [char; 7] = ['[', ']', ':', '*', '?', '/', '\\'];

/// Validate a sheet name (Excel rules: 1–31 chars, no `[]:*?/\`,
/// no leading/trailing apostrophe-only trickery is handled at parse level).
pub fn is_valid_sheet_name(name: &str) -> bool {
    if name.is_empty() || name.chars().count() > 31 {
        return false;
    }
    !name.chars().any(|c| FORBIDDEN_SHEET_CHARS.contains(&c))
}

/// Whether `name` can appear in a formula without quotes. Conservative:
/// letters, digits, `_`, `.` and non-ASCII alphanumerics; must not look like
/// a cell reference and must not start with a digit.
pub(crate) fn is_valid_unquoted_sheet_name(name: &str) -> bool {
    if !is_valid_sheet_name(name) {
        return false;
    }
    let mut chars = name.chars();
    let first = match chars.next() {
        Some(c) => c,
        None => return false,
    };
    if !(first.is_alphabetic() || first == '_') {
        return false;
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '.')
    {
        return false;
    }
    // "Sheet1" is fine, but "A1" as a sheet name is ambiguous — Excel
    // requires quoting in that case. Reject names that parse as cell refs.
    if CellRef::from_a1(name).is_ok() {
        return false;
    }
    true
}

/// Parse a cell reference at byte offset `start` of `s`.
/// Returns `(CellRef, end_offset)` where `end_offset` is relative to `s`.
fn parse_cell_ref(s: &str, start: usize) -> Result<(CellRef, usize), RefParseError> {
    let bytes = s.as_bytes();
    let mut i = start;

    let col_abs = if bytes.get(i) == Some(&b'$') {
        i += 1;
        true
    } else {
        false
    };

    let col_start = i;
    while let Some(&b) = bytes.get(i) {
        if b.is_ascii_alphabetic() {
            i += 1;
        } else {
            break;
        }
    }
    if i == col_start {
        return Err(RefParseError::new(RefParseErrorKind::ExpectedColumn, i));
    }
    let col = letters_to_col(&s[col_start..i])
        .ok_or_else(|| RefParseError::new(RefParseErrorKind::OutOfBounds, col_start))?;

    let row_abs = if bytes.get(i) == Some(&b'$') {
        i += 1;
        true
    } else {
        false
    };

    let row_start = i;
    while let Some(&b) = bytes.get(i) {
        if b.is_ascii_digit() {
            i += 1;
        } else {
            break;
        }
    }
    if i == row_start {
        return Err(RefParseError::new(RefParseErrorKind::ExpectedRow, i));
    }
    let row_digits = &s[row_start..i];
    if row_digits.starts_with('0') {
        // "A01" / "A0" are not valid A1 spellings.
        return Err(RefParseError::new(RefParseErrorKind::InvalidRow, row_start));
    }
    let row_1based: u64 = row_digits
        .parse()
        .map_err(|_| RefParseError::new(RefParseErrorKind::InvalidRow, row_start))?;
    if row_1based == 0 || row_1based > MAX_ROWS as u64 {
        return Err(RefParseError::new(
            RefParseErrorKind::OutOfBounds,
            row_start,
        ));
    }

    Ok((
        CellRef {
            row: (row_1based - 1) as u32,
            col,
            row_abs,
            col_abs,
        },
        i,
    ))
}

/// Convert column letters (`A`, `Z`, `AA`, `XFD`) to a 0-based index,
/// validating against `MAX_COLS`. Returns `None` on overflow.
pub fn letters_to_col(letters: &str) -> Option<u32> {
    if letters.is_empty() || letters.len() > 3 {
        return None;
    }
    let mut col: u64 = 0;
    for b in letters.bytes() {
        if !b.is_ascii_alphabetic() {
            return None;
        }
        col = col * 26 + (b.to_ascii_uppercase() - b'A') as u64 + 1;
        if col > MAX_COLS as u64 {
            return None;
        }
    }
    Some((col - 1) as u32)
}

/// Convert a 0-based column index to letters (`0 -> "A"`, `16383 -> "XFD"`).
pub fn col_to_letters(mut col: u32) -> String {
    debug_assert!(col < MAX_COLS);
    let mut buf = Vec::new();
    loop {
        buf.push((b'A' + (col % 26) as u8) as char);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    buf.iter().rev().collect()
}

/// Structured error for reference parsing, carrying a byte offset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefParseError {
    pub kind: RefParseErrorKind,
    /// Byte offset into the input string where the problem was detected.
    pub offset: usize,
}

impl RefParseError {
    pub fn new(kind: RefParseErrorKind, offset: usize) -> Self {
        RefParseError { kind, offset }
    }
}

/// Why a reference failed to parse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefParseErrorKind {
    /// Input ended before a reference was complete.
    Empty,
    /// Expected column letters.
    ExpectedColumn,
    /// Expected row digits.
    ExpectedRow,
    /// Row digits are present but malformed (e.g. leading zero).
    InvalidRow,
    /// Row or column outside the `MAX_ROWS`×`MAX_COLS` grid.
    OutOfBounds,
    /// Valid reference followed by unexpected characters.
    TrailingInput,
    /// Sheet name is empty or contains forbidden characters.
    InvalidSheetName,
    /// Quoted sheet name is missing its closing `'`.
    UnterminatedQuote,
    /// `[n]Sheet!A1`-style external workbook references are unsupported.
    UnsupportedExternalRef,
    /// Range form is recognized but not supported (e.g. `S!A1:S!B2`).
    UnsupportedRangeForm,
}

impl fmt::Display for RefParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let msg = match self.kind {
            RefParseErrorKind::Empty => "empty reference",
            RefParseErrorKind::ExpectedColumn => "expected column letters",
            RefParseErrorKind::ExpectedRow => "expected row digits",
            RefParseErrorKind::InvalidRow => "invalid row number",
            RefParseErrorKind::OutOfBounds => "reference out of bounds",
            RefParseErrorKind::TrailingInput => "unexpected trailing characters",
            RefParseErrorKind::InvalidSheetName => "invalid sheet name",
            RefParseErrorKind::UnterminatedQuote => "unterminated quoted sheet name",
            RefParseErrorKind::UnsupportedExternalRef => {
                "external workbook references are not supported"
            }
            RefParseErrorKind::UnsupportedRangeForm => "unsupported range form",
        };
        write!(f, "{msg} at byte {}", self.offset)
    }
}

impl std::error::Error for RefParseError {}
