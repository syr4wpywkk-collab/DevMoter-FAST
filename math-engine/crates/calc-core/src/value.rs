//! Core value type passed between cells, functions and the evaluator.

use crate::array::ArrayValue;
use crate::error::CalcError;
use crate::lambda::LambdaValue;
use crate::reference::RefValue;
use std::fmt;
use std::rc::Rc;

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
    /// Anonymous function produced by `LAMBDA` (v2 §3). Lambdas cannot be
    /// displayed in a cell: every scalar coercion yields `#VALUE!` and a
    /// lambda that reaches a cell boundary becomes `#VALUE!`.
    Lambda(Rc<LambdaValue>),
    /// A resolved cell-range reference (v3, ADR 0002). Produced by
    /// reference-returning functions (`OFFSET`, `INDIRECT`, the reference
    /// form of `INDEX`); the evaluator dereferences it to cell values
    /// before it can reach scalar coercion or a cell boundary, so a
    /// `Reference` observed by scalar coercion is `#VALUE!`.
    Reference(RefValue),
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
    Lambda,
    Reference,
}

impl Value {
    /// Excel has no negative zero: `-0.0` (e.g. from an empty `SUM`)
    /// becomes `0.0`.
    pub fn normalize_zero(self) -> Value {
        match self {
            Value::Number(0.0) => Value::Number(0.0),
            other => other,
        }
    }

    /// Classify this value.
    pub fn kind(&self) -> ValueKind {
        match self {
            Value::Blank => ValueKind::Blank,
            Value::Number(_) => ValueKind::Number,
            Value::Text(_) => ValueKind::Text,
            Value::Boolean(_) => ValueKind::Boolean,
            Value::Error(_) => ValueKind::Error,
            Value::Array(_) => ValueKind::Array,
            Value::Lambda(_) => ValueKind::Lambda,
            Value::Reference(_) => ValueKind::Reference,
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
            Value::Array(_) | Value::Lambda(_) | Value::Reference(_) => Err(CalcError::Value),
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
            Value::Array(_) | Value::Lambda(_) | Value::Reference(_) => Err(CalcError::Value),
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
            Value::Array(_) | Value::Lambda(_) | Value::Reference(_) => Err(CalcError::Value),
        }
    }
}

/// Parse text into a number the way Excel's implicit conversion does for
/// direct arguments: surrounding whitespace is ignored, a leading `+`/`-` is
/// allowed, and decimal/exponent forms are accepted. A trailing `%` divides
/// by 100 (Excel allows `="5%"+0`). Empty/whitespace-only text is rejected.
pub fn parse_number_text(s: &str) -> Option<f64> {
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

/// Round to the 15 significant digits Excel keeps when it shows or compares a number.
pub fn round_15(n: f64) -> f64 {
    if n == 0.0 || !n.is_finite() {
        return n;
    }
    format!("{n:.14e}").parse().unwrap_or(n)
}

/// Format a number the way Excel's General format turns it into text (`&`,
/// display): 15 significant digits, no trailing zeros, and scientific notation
/// (`1E+20`, `1.5E-10`) when the decimal exponent is at least 15 or below -9.
///
/// SPEC-OPEN: Excel's cell display also depends on column width; this is the
/// width-independent text form.
pub fn format_number(n: f64) -> String {
    if n == 0.0 {
        return "0".to_string();
    }
    if !n.is_finite() {
        return format!("{n}");
    }
    let sci = format!("{:.14e}", n.abs());
    let (mantissa, exponent) = sci.split_once('e').unwrap_or((&sci, "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let digits = digits.trim_end_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    let sign = if n < 0.0 { "-" } else { "" };
    if !(-9..15).contains(&exponent) {
        let (first, rest) = digits.split_at(1);
        let point = if rest.is_empty() { "" } else { "." };
        let exp_sign = if exponent < 0 { '-' } else { '+' };
        return format!("{sign}{first}{point}{rest}E{exp_sign}{:02}", exponent.abs());
    }
    if exponent < 0 {
        let zeros = "0".repeat((-exponent - 1) as usize);
        return format!("{sign}0.{zeros}{digits}");
    }
    let int_len = exponent as usize + 1;
    if digits.len() <= int_len {
        format!("{sign}{digits}{}", "0".repeat(int_len - digits.len()))
    } else {
        format!("{sign}{}.{}", &digits[..int_len], &digits[int_len..])
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
            Value::Lambda(_) => f.write_str("<lambda>"),
            Value::Reference(r) => write!(f, "<ref {}>", r.range.to_a1()),
        }
    }
}

#[cfg(test)]
mod general_format_tests {
    use super::{format_number, round_15};

    #[test]
    fn general_format_matches_excel_text() {
        let cases = [
            (0.1 + 0.2, "0.3"),
            (1.0 / 7.0, "0.142857142857143"),
            (123456789012345678.0, "1.23456789012346E+17"),
            (123456789012345.0, "123456789012345"),
            (1e20, "1E+20"),
            (1e-20, "1E-20"),
            (1.5e-10, "1.5E-10"),
            (1e-9, "0.000000001"),
            (7.257415615307999e306, "7.257415615308E+306"),
            (-2.5, "-2.5"),
            (-0.0, "0"),
            (42.0, "42"),
            (1000.0, "1000"),
            (0.000123, "0.000123"),
        ];
        for (n, text) in cases {
            assert_eq!(format_number(n), text, "{n:e}");
        }
        assert_eq!(round_15(0.1 + 0.2), 0.3);
    }
}
