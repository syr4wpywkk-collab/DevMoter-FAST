//! First-class cell-range references (v3 foundation, ADR 0002).
//!
//! A [`RefValue`] is a *resolved* reference: a sheet id plus a
//! normalized rectangular range. Functions like `OFFSET` and `INDIRECT`
//! produce references, and functions like `INDEX` may optionally return
//! one; consumers dereference them to cell values in scalar or array
//! position via [`crate::eval::EvalContext::deref`], or inspect their
//! geometry/sheet via [`crate::eval::EvalContext::eval_ref`].
//!
//! Multi-area references (unions like `(A1:B2,C3:D4)`, needed for the
//! `AREAS` count) and 3-D sheet-span references (`SHEETS(Sheet1:Sheet3!A1)`)
//! are deliberately out of scope for this foundation and are noted in
//! `docs/SPEC-OPEN.md`.

use crate::cell::{CellId, CellRef, RangeRef};

/// Maximum length of a reference text parsed at evaluation time
/// (`INDIRECT`-style `ref_text`). Bounds the work spent parsing
/// hostile or degenerate input; text beyond the limit is `#REF!`,
/// never a parse attempt. Well under the parser's `MAX_FORMULA_LEN`.
pub const MAX_REF_TEXT_LEN: usize = 8192;

/// A resolved reference to a rectangular range on a known sheet.
///
/// `range` is always stored normalized (`start <= end`); the written
/// orientation of an `INDIRECT`/`OFFSET` operand does not survive.
/// References are lightweight value objects: they carry no cell data,
/// so dereferencing reads the evaluator's current value snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RefValue {
    /// Resolved 0-based sheet index.
    pub sheet_id: u32,
    /// Referenced rectangle (normalized).
    pub range: RangeRef,
}

impl RefValue {
    /// A range reference; `range` is normalized on construction.
    pub fn new(sheet_id: u32, range: RangeRef) -> RefValue {
        RefValue {
            sheet_id,
            range: range.normalized(),
        }
    }

    /// A single-cell reference.
    pub fn single(sheet_id: u32, cell: CellRef) -> RefValue {
        RefValue {
            sheet_id,
            range: RangeRef {
                start: cell,
                end: cell,
            },
        }
    }

    /// True for a 1x1 reference.
    pub fn is_single(&self) -> bool {
        self.range.start.row == self.range.end.row && self.range.start.col == self.range.end.col
    }

    /// Rows covered.
    pub fn rows(&self) -> u32 {
        self.range.end.row - self.range.start.row + 1
    }

    /// Columns covered.
    pub fn cols(&self) -> u32 {
        self.range.end.col - self.range.start.col + 1
    }

    /// Total cells covered.
    pub fn cell_count(&self) -> u64 {
        u64::from(self.rows()) * u64::from(self.cols())
    }

    /// The top-left (anchor) cell of the referenced range — where
    /// `OFFSET` displacement starts and where single-cell metadata
    /// queries (`FORMULATEXT`, `ISFORMULA`) look.
    pub fn top_left(&self) -> CellId {
        CellId {
            sheet_id: self.sheet_id,
            row: self.range.start.row,
            col: self.range.start.col,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(r1: u32, c1: u32, r2: u32, c2: u32) -> RangeRef {
        RangeRef {
            start: CellRef {
                row: r1,
                col: c1,
                row_abs: false,
                col_abs: false,
            },
            end: CellRef {
                row: r2,
                col: c2,
                row_abs: false,
                col_abs: false,
            },
        }
    }

    #[test]
    fn normalizes_on_construction() {
        let v = RefValue::new(0, r(3, 3, 1, 1));
        assert_eq!(v.range.start.row, 1);
        assert_eq!(v.range.end.row, 3);
        assert_eq!((v.rows(), v.cols(), v.cell_count()), (3, 3, 9));
    }

    #[test]
    fn single_cell() {
        let v = RefValue::single(
            2,
            CellRef {
                row: 4,
                col: 1,
                row_abs: true,
                col_abs: false,
            },
        );
        assert!(v.is_single());
        assert_eq!(
            v.top_left(),
            CellId {
                sheet_id: 2,
                row: 4,
                col: 1
            }
        );
    }
}
