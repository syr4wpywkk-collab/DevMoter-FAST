//! Minimal workbook/sheet structure.
//!
//! Cells store their *input* — either a literal [`Value`] or a formula's
//! source text. Parsing, dependency tracking and evaluation are layered on
//! top in later PRs; nothing here evaluates formulas.

use std::collections::BTreeMap;

use crate::cell::{CellId, CellRef, MAX_COLS, MAX_ROWS, RefParseError, is_valid_sheet_name};
use crate::value::Value;

/// Which epoch the workbook uses for date serial numbers.
///
/// `Excel1900` counts days since 1899-12-31 and reproduces Excel's famous
/// fictitious 1900-02-29 (serial 60) for compatibility. `Excel1904` counts
/// since 1904-01-01 (old Mac default). Conversion between serials and
/// calendar dates lands with the date functions (PR 08); this type fixes
/// where the setting lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum DateSystem {
    /// Excel/Windows default. Includes the fictitious 1900-02-29.
    #[default]
    Excel1900,
    /// Old Mac default; epoch is 1904-01-01.
    Excel1904,
}

/// What was typed into a cell.
#[derive(Debug, Clone, PartialEq)]
pub enum CellInput {
    /// A literal value.
    Value(Value),
    /// Formula source text *without* the leading `=`.
    ///
    /// The text is kept verbatim; the AST/evaluated value/dirty flags from
    /// the plan (§3.2) are added alongside this when the evaluator lands.
    Formula(String),
}

impl CellInput {
    /// Build an input the way a UI would: a leading `=` marks a formula,
    /// anything else is stored as text.
    pub fn from_typed(s: &str) -> CellInput {
        match s.strip_prefix('=') {
            Some(f) => CellInput::Formula(f.to_string()),
            None => CellInput::Value(Value::Text(s.to_string())),
        }
    }

    /// `Some(formula)` when this input is a formula.
    pub fn formula(&self) -> Option<&str> {
        match self {
            CellInput::Formula(f) => Some(f),
            _ => None,
        }
    }

    pub fn is_formula(&self) -> bool {
        matches!(self, CellInput::Formula(_))
    }
}

/// A single cell: its raw input plus room for evaluator metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct Cell {
    /// What was entered (value or formula text).
    pub input: CellInput,
}

/// Errors from workbook mutations/lookups.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkbookError {
    /// No sheet with this name/id exists.
    SheetNotFound,
    /// A sheet with this name (case-insensitive) already exists.
    DuplicateSheetName(String),
    /// Sheet name violates Excel's naming rules.
    InvalidSheetName(String),
    /// Row/col outside the grid.
    CellOutOfBounds,
    /// Address string failed to parse.
    BadAddress(RefParseError),
}

impl std::fmt::Display for WorkbookError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WorkbookError::SheetNotFound => write!(f, "sheet not found"),
            WorkbookError::DuplicateSheetName(n) => write!(f, "duplicate sheet name: {n}"),
            WorkbookError::InvalidSheetName(n) => write!(f, "invalid sheet name: {n:?}"),
            WorkbookError::CellOutOfBounds => write!(f, "cell out of bounds"),
            WorkbookError::BadAddress(e) => write!(f, "bad address: {e}"),
        }
    }
}

impl std::error::Error for WorkbookError {}

/// A single worksheet: sparse cell storage keyed by 0-based `(row, col)`.
#[derive(Debug, Clone)]
pub struct Sheet {
    id: u32,
    name: String,
    cells: BTreeMap<(u32, u32), Cell>,
}

impl Sheet {
    pub fn id(&self) -> u32 {
        self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn cell(&self, row: u32, col: u32) -> Option<&Cell> {
        self.cells.get(&(row, col))
    }

    pub fn cell_mut(&mut self, row: u32, col: u32) -> Option<&mut Cell> {
        self.cells.get_mut(&(row, col))
    }

    /// Iterate over populated cells in row-major order.
    pub fn cells(&self) -> impl Iterator<Item = (CellId, &Cell)> {
        let id = self.id;
        self.cells.iter().map(move |(&(row, col), cell)| {
            (
                CellId {
                    sheet_id: id,
                    row,
                    col,
                },
                cell,
            )
        })
    }

    /// Number of populated cells.
    pub fn len(&self) -> usize {
        self.cells.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }
}

/// A workbook: ordered sheets plus workbook-level settings.
#[derive(Debug, Clone)]
pub struct Workbook {
    sheets: Vec<Sheet>,
    date_system: DateSystem,
}

impl Default for Workbook {
    fn default() -> Self {
        Workbook::new()
    }
}

impl Workbook {
    /// Empty workbook with the default (1900) date system.
    pub fn new() -> Workbook {
        Workbook {
            sheets: Vec::new(),
            date_system: DateSystem::default(),
        }
    }

    /// Empty workbook with an explicit date system.
    pub fn with_date_system(date_system: DateSystem) -> Workbook {
        Workbook {
            sheets: Vec::new(),
            date_system,
        }
    }

    pub fn date_system(&self) -> DateSystem {
        self.date_system
    }

    pub fn set_date_system(&mut self, date_system: DateSystem) {
        self.date_system = date_system;
    }

    /// Create a sheet, returning its id. Names must be valid Excel sheet
    /// names and unique case-insensitively.
    pub fn add_sheet(&mut self, name: &str) -> Result<u32, WorkbookError> {
        if !is_valid_sheet_name(name) {
            return Err(WorkbookError::InvalidSheetName(name.to_string()));
        }
        if self.sheet_id(name).is_some() {
            return Err(WorkbookError::DuplicateSheetName(name.to_string()));
        }
        let id = self.sheets.len() as u32;
        self.sheets.push(Sheet {
            id,
            name: name.to_string(),
            cells: BTreeMap::new(),
        });
        Ok(id)
    }

    /// Sheet lookup by name, case-insensitive (Excel treats `Sheet1` and
    /// `SHEET1` as the same sheet).
    pub fn sheet_id(&self, name: &str) -> Option<u32> {
        self.sheets
            .iter()
            .find(|s| s.name.eq_ignore_ascii_case(name))
            .map(|s| s.id)
    }

    pub fn sheet(&self, id: u32) -> Option<&Sheet> {
        self.sheets.get(id as usize)
    }

    pub fn sheet_mut(&mut self, id: u32) -> Option<&mut Sheet> {
        self.sheets.get_mut(id as usize)
    }

    pub fn sheet_by_name(&self, name: &str) -> Option<&Sheet> {
        self.sheet_id(name).and_then(|id| self.sheet(id))
    }

    pub fn sheets(&self) -> &[Sheet] {
        &self.sheets
    }

    /// Store `input` at `(row, col)` on sheet `id`.
    pub fn set_cell(
        &mut self,
        sheet_id: u32,
        row: u32,
        col: u32,
        input: CellInput,
    ) -> Result<(), WorkbookError> {
        if row >= MAX_ROWS || col >= MAX_COLS {
            return Err(WorkbookError::CellOutOfBounds);
        }
        let sheet = self
            .sheet_mut(sheet_id)
            .ok_or(WorkbookError::SheetNotFound)?;
        sheet.cells.insert((row, col), Cell { input });
        Ok(())
    }

    /// Remove the cell's content (makes it blank).
    pub fn clear_cell(&mut self, sheet_id: u32, row: u32, col: u32) -> Result<(), WorkbookError> {
        let sheet = self
            .sheet_mut(sheet_id)
            .ok_or(WorkbookError::SheetNotFound)?;
        sheet.cells.remove(&(row, col));
        Ok(())
    }

    /// Read a cell by 0-based coordinates.
    pub fn cell(&self, sheet_id: u32, row: u32, col: u32) -> Option<&Cell> {
        self.sheet(sheet_id)?.cell(row, col)
    }

    /// Convenience: `set_cell` addressed by sheet name + A1 string.
    /// Absolute markers (`$A$1`) are accepted and ignored for storage.
    pub fn set_cell_a1(
        &mut self,
        sheet: &str,
        address: &str,
        input: CellInput,
    ) -> Result<(), WorkbookError> {
        let sheet_id = self.sheet_id(sheet).ok_or(WorkbookError::SheetNotFound)?;
        let r = CellRef::from_a1(address).map_err(WorkbookError::BadAddress)?;
        self.set_cell(sheet_id, r.row, r.col, input)
    }

    /// Convenience: `cell` addressed by sheet name + A1 string.
    pub fn cell_a1(&self, sheet: &str, address: &str) -> Result<Option<&Cell>, WorkbookError> {
        let sheet_id = self.sheet_id(sheet).ok_or(WorkbookError::SheetNotFound)?;
        let r = CellRef::from_a1(address).map_err(WorkbookError::BadAddress)?;
        Ok(self.cell(sheet_id, r.row, r.col))
    }
}
