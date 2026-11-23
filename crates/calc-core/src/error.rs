//! Error values understood by the engine.
//!
//! Each variant corresponds to an Excel-style error literal. `Circ` is an
//! internal representation for circular references whose display policy is
//! still open (see docs/SPEC-OPEN.md).

use std::fmt;

/// Spreadsheet error values.
///
/// Variants map 1:1 onto the Excel error literals shown by [`CalcError::code`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CalcError {
    /// `#DIV/0!` — division by zero or empty aggregate input.
    DivZero,
    /// `#VALUE!` — wrong argument type or failed coercion.
    Value,
    /// `#REF!` — invalid or out-of-bounds cell reference.
    Ref,
    /// `#NAME?` — unrecognized name or function.
    Name,
    /// `#NUM!` — invalid numeric value.
    Num,
    /// `#N/A` — value not available / not found.
    NA,
    /// `#NULL!` — empty intersection of ranges.
    Null,
    /// `#SPILL!` — dynamic array spill range is obstructed.
    Spill,
    /// `#CALC!` — generic calculation error (e.g. empty FILTER result).
    Calc,
    /// `#CIRC!` — internal marker for circular references.
    ///
    /// Not a standard Excel literal; Excel reports circular references
    /// through a separate UI mechanism. Kept as a distinct variant so the
    /// evaluator can propagate it as a typed error. Display policy is a
    /// SPEC-OPEN item.
    Circ,
}

impl CalcError {
    /// All variants, in a stable order. Useful for exhaustive tests.
    pub const ALL: [CalcError; 10] = [
        CalcError::DivZero,
        CalcError::Value,
        CalcError::Ref,
        CalcError::Name,
        CalcError::Num,
        CalcError::NA,
        CalcError::Null,
        CalcError::Spill,
        CalcError::Calc,
        CalcError::Circ,
    ];

    /// The Excel-style literal used to display this error.
    pub fn code(self) -> &'static str {
        match self {
            CalcError::DivZero => "#DIV/0!",
            CalcError::Value => "#VALUE!",
            CalcError::Ref => "#REF!",
            CalcError::Name => "#NAME?",
            CalcError::Num => "#NUM!",
            CalcError::NA => "#N/A",
            CalcError::Null => "#NULL!",
            CalcError::Spill => "#SPILL!",
            CalcError::Calc => "#CALC!",
            CalcError::Circ => "#CIRC!",
        }
    }

    /// Parse an Excel-style error literal back into a [`CalcError`].
    ///
    /// Accepts the exact canonical spellings produced by [`CalcError::code`],
    /// case-insensitively. Returns `None` for anything else.
    pub fn from_code(s: &str) -> Option<CalcError> {
        CalcError::ALL
            .iter()
            .copied()
            .find(|e| e.code().eq_ignore_ascii_case(s))
    }
}

impl fmt::Display for CalcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for CalcError {}
