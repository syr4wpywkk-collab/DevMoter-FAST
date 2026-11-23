//! Core value type passed between cells, functions and the evaluator.

use crate::array::ArrayValue;
use crate::error::CalcError;
use std::fmt;

/// A single spreadsheet value.
///
/// `Blank` (an untouched/empty cell or a genuinely empty argument) is
/// deliberately distinct from `Text("")` (an empty *string*): functions such
/// as `COUNTA` treat them differently.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// Empty cell / empty argument. Not the same as `Text("")`.
    Blank,
    /// IEEE 754 double, matching Excel's numeric model.
    Number(f64),
    /// Text value. May be empty.
    Text(String),
    /// Logical value.
    Boolean(bool),
    /// Error value; propagates through most operations unchanged.
    Error(CalcError),
    /// Rectangular 2-D array (dynamic array / spill result, array literals).
    Array(ArrayValue),
}

/// The kind of a [`Value`], for error messages and type checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueKind {
    Blank,
    Number,
    Text,
    Boolean,
    Error,
    Array,
}

impl Value {
    /// Classify this value.
    pub fn kind(&self) -> ValueKind {
        match self {
            Value::Blank => ValueKind::Blank,
            Value::Number(_) => ValueKind::Number,
            Value::Text(_) => ValueKind::Text,
            Value::Boolean(_) => ValueKind::Boolean,
            Value::Error(_) => ValueKind::Error,
            Value::Array(_) => ValueKind::Array,
        }
    }

    pub fn is_blank(&self) -> bool {
        matches!(self, Value::Blank)
    }

    pub fn is_error(&self) -> bool {
        matches!(self, Value::Error(_))
    }

    /// If this value is an error, return it; errors short-circuit evaluation.
    pub fn error(&self) -> Option<CalcError> {
        match self {
            Value::Error(e) => Some(*e),
            _ => None,
        }
    }

    /// Implicit coercion to `f64` using the "direct argument" rules:
    ///
    /// - `Blank` → `0`
    /// - `Number` → itself
    /// - `Boolean` → `1` / `0`
    /// - `Text` → parsed as a number (trimmed, optional `+`/`-`, decimal and
    ///   exponent notation); unparseable text → `#VALUE!`
    /// - `Error` → propagated
    /// - `Array` → `#VALUE!` (scalar coercion of an array)
    ///
    /// Note: range-derived blanks/text follow different rules inside many
    /// functions (e.g. `SUM` ignores them); those rules belong to the
    /// function implementations, not to this coercion.
    pub fn to_number(&self) -> Result<f64, CalcError> {
        match self {
            Value::Blank => Ok(0.0),
            Value::Number(n) => Ok(*n),
            Value::Boolean(b) => Ok(if *b { 1.0 } else { 0.0 }),
            Value::Text(s) => parse_number_text(s).ok_or(CalcError::Value),
            Value::Error(e) => Err(*e),
            Value::Array(_) => Err(CalcError::Value),
        }
    }

    /// Implicit coercion to `bool`:
    ///
    /// - `Blank` → `false`
    /// - `Boolean` → itself
    /// - `Number` → `!= 0` (NaN counts as non-zero → `true`)
    /// - `Text` → case-insensitive `"TRUE"`/`"FALSE"`, else `#VALUE!`
    /// - `Error` → propagated; `Array` → `#VALUE!`
    pub fn to_boolean(&self) -> Result<bool, CalcError> {
        match self {
            Value::Blank => Ok(false),
            Value::Boolean(b) => Ok(*b),
            Value::Number(n) => Ok(*n != 0.0),
            Value::Text(s) => match s.trim().to_ascii_uppercase().as_str() {
                "TRUE" => Ok(true),
                "FALSE" => Ok(false),
                _ => Err(CalcError::Value),
            },
            Value::Error(e) => Err(*e),
            Value::Array(_) => Err(CalcError::Value),
        }
    }

    /// Implicit coercion to `String`:
    ///
    /// - `Blank` → `""`
    /// - `Number` → Excel "General"-like formatting (see [`format_number`])
    /// - `Boolean` → `"TRUE"` / `"FALSE"`
    /// - `Error` → propagated; `Array` → `#VALUE!`
    ///
    /// SPEC-OPEN: exact Excel General-format parity (scientific notation
    /// thresholds, trailing-zero rules) is not fully matched yet.
    pub fn to_text(&self) -> Result<String, CalcError> {
        match self {
            Value::Blank => Ok(String::new()),
            Value::Text(s) => Ok(s.clone()),
            Value::Number(n) => Ok(format_number(*n)),
            Value::Boolean(b) => Ok(if *b { "TRUE" } else { "FALSE" }.to_string()),
            Value::Error(e) => Err(*e),
            Value::Array(_) => Err(CalcError::Value),
        }
    }
}

/// Parse text into a number the way Excel's implicit conversion does for
/// direct arguments: surrounding whitespace is ignored, a leading `+`/`-` is
/// allowed, and decimal/exponent forms are accepted. A trailing `%` divides
/// by 100 (Excel allows `="5%"+0`). Empty/whitespace-only text is rejected.
pub(crate) fn parse_number_text(s: &str) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(rest) = t.strip_suffix('%') {
        return parse_number_text(rest).map(|n| n / 100.0);
    }
    // Reject spellings Rust accepts but Excel formulas cannot produce as
    // literals ("NaN", "inf") — except that typed input may still create
    // them via number formatting; implicit text->number rejects them.
    if t.eq_ignore_ascii_case("nan")
        || t.eq_ignore_ascii_case("inf")
        || t.eq_ignore_ascii_case("infinity")
        || t.eq_ignore_ascii_case("+inf")
        || t.eq_ignore_ascii_case("-inf")
        || t.eq_ignore_ascii_case("+infinity")
        || t.eq_ignore_ascii_case("-infinity")
    {
        return None;
    }
    t.parse::<f64>().ok()
}

/// Format a number roughly like Excel's General format: integers without a
/// decimal point, non-integers with the shortest round-trip representation.
/// Scientific notation is used for very large/small magnitudes.
///
/// SPEC-OPEN: Excel switches to scientific notation based on column width;
/// the engine picks fixed thresholds (>= 1e15 shows the 15-significant-digit
/// style Excel uses internally). Exact parity is a compatibility-fixture item.
pub fn format_number(n: f64) -> String {
    if n == 0.0 {
        "0".to_string()
    } else if n == n.trunc() && n.abs() < 1e15 {
        format!("{n:.0}")
    } else {
        // Shortest representation that round-trips (Rust's default Display).
        let mut s = format!("{n}");
        // Rust never emits "E+..." for Display; leave as-is.
        if s == "-0" {
            s = "0".to_string();
        }
        s
    }
}

impl From<f64> for Value {
    fn from(n: f64) -> Value {
        Value::Number(n)
    }
}

impl From<bool> for Value {
    fn from(b: bool) -> Value {
        Value::Boolean(b)
    }
}

impl From<String> for Value {
    fn from(s: String) -> Value {
        Value::Text(s)
    }
}

impl From<&str> for Value {
    fn from(s: &str) -> Value {
        Value::Text(s.to_string())
    }
}

impl From<CalcError> for Value {
    fn from(e: CalcError) -> Value {
        Value::Error(e)
    }
}

impl fmt::Display for Value {
    /// Display form useful for debugging/CLI output. `Text` is shown raw,
    /// errors via their Excel literal. Not intended as cell-format output.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Blank => Ok(()),
            Value::Number(n) => write!(f, "{}", format_number(*n)),
            Value::Text(s) => f.write_str(s),
            Value::Boolean(b) => f.write_str(if *b { "TRUE" } else { "FALSE" }),
            Value::Error(e) => write!(f, "{e}"),
            Value::Array(a) => write!(f, "<array {}x{}>", a.rows(), a.cols()),
        }
    }
}
