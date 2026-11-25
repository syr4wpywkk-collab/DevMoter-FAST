//! Rectangular 2-D array value with validated bounds.

use crate::error::CalcError;
use crate::value::Value;

/// Maximum number of cells in a single [`ArrayValue`].
///
/// From the input limits proposed in docs/IMPLEMENTATION_PLAN.md §10.4
/// ("動的配列100万セル"). Configurable engine budgets may tighten this later.
pub const MAX_ARRAY_CELLS: usize = 1_000_000;

/// Maximum rows of an [`ArrayValue`]; matches the worksheet grid height.
pub const MAX_ARRAY_ROWS: u32 = crate::cell::MAX_ROWS;

/// Maximum columns of an [`ArrayValue`]; matches the worksheet grid width.
pub const MAX_ARRAY_COLS: u32 = crate::cell::MAX_COLS;

/// A dense, rectangular matrix of [`Value`]s stored in row-major order.
///
/// Invariants (enforced by [`ArrayValue::new`] / [`ArrayValue::fill`]):
/// - `1 <= rows <= MAX_ARRAY_ROWS` and `1 <= cols <= MAX_ARRAY_COLS`
/// - `rows * cols <= MAX_ARRAY_CELLS`
/// - `cells.len() == rows * cols`
#[derive(Debug, Clone, PartialEq)]
pub struct ArrayValue {
    rows: u32,
    cols: u32,
    cells: Vec<Value>,
}

impl ArrayValue {
    /// Build an array from row-major `cells`, validating the dimensions.
    ///
    /// Returns `#VALUE!` for empty dimensions, size mismatches, or when a
    /// limit is exceeded. A dedicated error kind may be introduced later if
    /// callers need to distinguish limit violations (SPEC-OPEN).
    pub fn new(rows: u32, cols: u32, cells: Vec<Value>) -> Result<ArrayValue, CalcError> {
        if rows == 0 || cols == 0 {
            return Err(CalcError::Value);
        }
        if rows > MAX_ARRAY_ROWS || cols > MAX_ARRAY_COLS {
            return Err(CalcError::Value);
        }
        let expected = rows as usize * cols as usize;
        if expected > MAX_ARRAY_CELLS || cells.len() != expected {
            return Err(CalcError::Value);
        }
        Ok(ArrayValue { rows, cols, cells })
    }

    /// Build an array where every cell holds `v`.
    pub fn fill(rows: u32, cols: u32, v: Value) -> Result<ArrayValue, CalcError> {
        if rows == 0 || cols == 0 || rows > MAX_ARRAY_ROWS || cols > MAX_ARRAY_COLS {
            return Err(CalcError::Value);
        }
        let len = rows as usize * cols as usize;
        if len > MAX_ARRAY_CELLS {
            return Err(CalcError::Value);
        }
        Ok(ArrayValue {
            rows,
            cols,
            cells: vec![v; len],
        })
    }

    /// Build a single-column array from a list of values.
    pub fn from_column(cells: Vec<Value>) -> Result<ArrayValue, CalcError> {
        let rows = cells.len() as u32;
        ArrayValue::new(rows, 1, cells)
    }

    /// Build a single-row array from a list of values.
    pub fn from_row(cells: Vec<Value>) -> Result<ArrayValue, CalcError> {
        let cols = cells.len() as u32;
        ArrayValue::new(1, cols, cells)
    }

    pub fn rows(&self) -> u32 {
        self.rows
    }

    pub fn cols(&self) -> u32 {
        self.cols
    }

    /// Total number of cells (`rows * cols`).
    pub fn len(&self) -> usize {
        self.cells.len()
    }

    /// Always false — empty arrays cannot be constructed.
    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }

    /// Get the cell at 0-based `(row, col)`, or `None` when out of bounds.
    pub fn get(&self, row: u32, col: u32) -> Option<&Value> {
        if row >= self.rows || col >= self.cols {
            return None;
        }
        Some(&self.cells[row as usize * self.cols as usize + col as usize])
    }

    /// Mutable access to the cell at 0-based `(row, col)`.
    pub fn get_mut(&mut self, row: u32, col: u32) -> Option<&mut Value> {
        if row >= self.rows || col >= self.cols {
            return None;
        }
        Some(&mut self.cells[row as usize * self.cols as usize + col as usize])
    }

    /// Iterate over cells in row-major order.
    pub fn iter(&self) -> std::slice::Iter<'_, Value> {
        self.cells.iter()
    }

    /// All cells as a row-major slice.
    pub fn cells(&self) -> &[Value] {
        &self.cells
    }
}

impl IntoIterator for ArrayValue {
    type Item = Value;
    type IntoIter = std::vec::IntoIter<Value>;
    fn into_iter(self) -> Self::IntoIter {
        self.cells.into_iter()
    }
}
