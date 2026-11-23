//! `CalcEngine`: workbook + dependency graph + incremental recalculation
//! (plan §5, public API sketch §9).
//!
//! The engine owns a [`Workbook`]. [`CalcEngine::set_cell`] parses formulas,
//! maintains the dependency graph, and marks the changed cell plus its
//! transitive dependents dirty. [`CalcEngine::recalculate`] re-evaluates
//! only dirty formula cells in dependency (topological) order; cells in a
//! dependency cycle evaluate to [`CalcError::Circ`].
//!
//! The evaluation step budget ([`MAX_EVAL_STEPS`]) spans a whole
//! `recalculate` call: exceeding it aborts with
//! [`EngineError::Eval`], leaving un-evaluated cells dirty.

use std::collections::{HashMap, HashSet};
use std::fmt;

use crate::ast::Expr;
use crate::cell::CellId;
use crate::cell::CellRef;
use crate::error::CalcError;
use crate::eval::{Clock, EvalContext, EvalError, SystemClock};
use crate::graph::{self, Dep};
use crate::parser::{ParseError, parse};
use crate::value::Value;
use crate::workbook::{CellInput, Workbook, WorkbookError};

/// Failures of engine-level operations. Per-cell spreadsheet errors are
/// `Value::Error(..)` results, not `EngineError`s.
#[derive(Debug)]
pub enum EngineError {
    /// Sheet lookup / address / bounds failure.
    Workbook(WorkbookError),
    /// Formula text failed to parse. The cell is not modified.
    Parse(ParseError),
    /// Fatal evaluation condition (step budget / depth). `recalculate`
    /// aborts; cells not yet evaluated stay dirty.
    Eval(EvalError),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::Workbook(e) => write!(f, "{e}"),
            EngineError::Parse(e) => write!(f, "{e}"),
            EngineError::Eval(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for EngineError {}

impl From<WorkbookError> for EngineError {
    fn from(e: WorkbookError) -> EngineError {
        EngineError::Workbook(e)
    }
}

impl From<ParseError> for EngineError {
    fn from(e: ParseError) -> EngineError {
        EngineError::Parse(e)
    }
}

impl From<EvalError> for EngineError {
    fn from(e: EvalError) -> EngineError {
        EngineError::Eval(e)
    }
}

/// Outcome of one [`CalcEngine::recalculate`] call.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RecalcReport {
    /// Formula cells (re)evaluated this pass, in evaluation order.
    pub evaluated: Vec<CellId>,
    /// Cells found inside a dependency cycle (assigned `#CIRC!`).
    pub cycle_cells: Vec<CellId>,
    /// Evaluation steps consumed.
    pub steps: usize,
}

/// Spreadsheet engine: workbook contents plus the recalculation state
/// (parsed ASTs, dependency graph, cached values, dirty set).
pub struct CalcEngine {
    workbook: Workbook,
    /// Parsed AST per formula cell.
    parsed: HashMap<CellId, Expr>,
    /// Dependency targets per formula cell.
    deps: HashMap<CellId, Vec<Dep>>,
    /// Current value of every populated cell (formula results included).
    values: HashMap<CellId, Value>,
    /// Formula cells needing (re)evaluation.
    dirty: HashSet<CellId>,
    clock: Box<dyn Clock>,
}

impl CalcEngine {
    /// Engine over an empty workbook with the system clock.
    pub fn new() -> CalcEngine {
        CalcEngine::with_workbook(Workbook::new())
    }

    /// Engine over an existing workbook with the system clock.
    pub fn with_workbook(workbook: Workbook) -> CalcEngine {
        CalcEngine {
            workbook,
            parsed: HashMap::new(),
            deps: HashMap::new(),
            values: HashMap::new(),
            dirty: HashSet::new(),
            clock: Box::new(SystemClock),
        }
    }

    /// Inject a clock for volatile functions (plan §5). Replaces the
    /// default [`SystemClock`].
    pub fn set_clock(&mut self, clock: Box<dyn Clock>) {
        self.clock = clock;
    }

    pub fn workbook(&self) -> &Workbook {
        &self.workbook
    }

    pub fn workbook_mut(&mut self) -> &mut Workbook {
        &mut self.workbook
    }

    /// Add a sheet (thin wrapper kept for API symmetry with §9).
    pub fn add_sheet(&mut self, name: &str) -> Result<u32, EngineError> {
        Ok(self.workbook.add_sheet(name)?)
    }

    /// Store `input` at `address` on `sheet`, update the dependency graph
    /// and mark dependents dirty.
    ///
    /// A formula that fails to parse is rejected: the cell keeps its
    /// previous contents and nothing is dirtied. (Excel's "formula not
    /// accepted" UX maps to this rejection.)
    pub fn set_cell(
        &mut self,
        sheet: &str,
        address: &str,
        input: CellInput,
    ) -> Result<(), EngineError> {
        let sheet_id = self
            .workbook
            .sheet_id(sheet)
            .ok_or(WorkbookError::SheetNotFound)?;
        let r = CellRef::from_a1(address).map_err(WorkbookError::BadAddress)?;
        let id = CellId {
            sheet_id,
            row: r.row,
            col: r.col,
        };

        match input {
            CellInput::Formula(text) => {
                // Parse before mutating anything.
                let expr = parse(&text)?;
                let deps = graph::extract_deps(&expr, &self.workbook, sheet_id);
                self.workbook
                    .set_cell(sheet_id, r.row, r.col, CellInput::Formula(text))?;
                self.parsed.insert(id, expr);
                self.deps.insert(id, deps);
            }
            CellInput::Value(v) => {
                self.values.insert(id, v.clone());
                self.workbook
                    .set_cell(sheet_id, r.row, r.col, CellInput::Value(v))?;
                self.parsed.remove(&id);
                self.deps.remove(&id);
                self.dirty.remove(&id);
            }
        }
        self.mark_dirty(id);
        Ok(())
    }

    /// Remove a cell's contents (back to blank), marking dependents dirty.
    pub fn clear_cell(&mut self, sheet: &str, address: &str) -> Result<(), EngineError> {
        let sheet_id = self
            .workbook
            .sheet_id(sheet)
            .ok_or(WorkbookError::SheetNotFound)?;
        let r = CellRef::from_a1(address).map_err(WorkbookError::BadAddress)?;
        let id = CellId {
            sheet_id,
            row: r.row,
            col: r.col,
        };
        self.workbook.clear_cell(sheet_id, r.row, r.col)?;
        self.parsed.remove(&id);
        self.deps.remove(&id);
        self.values.remove(&id);
        self.dirty.remove(&id);
        self.mark_dependents_dirty(id);
        Ok(())
    }

    /// Current value of a cell, recalculating first if needed.
    pub fn get_value(&mut self, sheet: &str, address: &str) -> Result<Value, EngineError> {
        let sheet_id = self
            .workbook
            .sheet_id(sheet)
            .ok_or(WorkbookError::SheetNotFound)?;
        let r = CellRef::from_a1(address).map_err(WorkbookError::BadAddress)?;
        self.recalculate()?;
        Ok(self
            .values
            .get(&CellId {
                sheet_id,
                row: r.row,
                col: r.col,
            })
            .cloned()
            .unwrap_or(Value::Blank))
    }

    /// Evaluate a formula against the current sheet contents *without*
    /// storing it in a cell (scratch evaluation, e.g. fixture/CLI use).
    /// References resolve against the latest recalculated values.
    pub fn eval_formula(&mut self, sheet: &str, formula: &str) -> Result<Value, EngineError> {
        let sheet_id = self
            .workbook
            .sheet_id(sheet)
            .ok_or(WorkbookError::SheetNotFound)?;
        self.recalculate()?;
        let expr = parse(formula)?;
        let mut ctx = self.make_ctx(sheet_id);
        Ok(ctx.eval(&expr)?)
    }

    /// Is this formula cell awaiting (re)evaluation?
    pub fn is_dirty(&self, sheet: &str, address: &str) -> bool {
        let Some(sheet_id) = self.workbook.sheet_id(sheet) else {
            return false;
        };
        let Ok(r) = CellRef::from_a1(address) else {
            return false;
        };
        self.dirty.contains(&CellId {
            sheet_id,
            row: r.row,
            col: r.col,
        })
    }

    /// Recompute every dirty formula cell in dependency order.
    ///
    /// Cycle members get `#CIRC!` immediately; the rest are evaluated in
    /// topological order so referenced values are always current.
    pub fn recalculate(&mut self) -> Result<RecalcReport, EngineError> {
        let mut report = RecalcReport::default();
        if self.dirty.is_empty() {
            return Ok(report);
        }

        // Cycle detection over the dirty subgraph.
        let cyclic = graph::cycle_members(&self.dirty, &self.deps);
        for c in &cyclic {
            self.values.insert(*c, Value::Error(CalcError::Circ));
            self.dirty.remove(c);
            report.cycle_cells.push(*c);
        }

        // Topological order over the remaining dirty cells (DFS post-order
        // on dependency edges restricted to the dirty set).
        let order = self.topo_order();

        for id in order {
            let expr = self.parsed[&id].clone();
            let (value, steps) = {
                let mut ctx = self.make_ctx(id.sheet_id);
                let v = ctx.eval(&expr)?;
                (v, ctx.steps())
            };
            report.steps += steps;
            if report.steps > crate::eval::MAX_EVAL_STEPS {
                return Err(EngineError::Eval(EvalError::StepBudgetExceeded));
            }
            self.values.insert(id, value);
            self.dirty.remove(&id);
            report.evaluated.push(id);
        }
        Ok(report)
    }

    /// Dirty formula cells in dependency-first order (a cell always sorts
    /// after the dirty cells it depends on): post-order DFS over dep edges
    /// restricted to the dirty set.
    fn topo_order(&self) -> Vec<CellId> {
        let dirty = &self.dirty;
        // Adjacency within the dirty set (same expansion as the SCC pass).
        let mut adj: HashMap<CellId, Vec<CellId>> = HashMap::with_capacity(dirty.len());
        for &c in dirty {
            let mut edges = Vec::new();
            for dep in self.deps.get(&c).into_iter().flatten() {
                match dep {
                    Dep::Cell(t) if dirty.contains(t) => edges.push(*t),
                    Dep::Range { sheet_id, range } => {
                        for m in dirty {
                            if m.sheet_id == *sheet_id && range.contains(m.row, m.col) {
                                edges.push(*m);
                            }
                        }
                    }
                    _ => {}
                }
            }
            adj.insert(c, edges);
        }

        let mut order = Vec::with_capacity(dirty.len());
        let mut seen: HashSet<CellId> = HashSet::new();
        for &start in dirty {
            if seen.contains(&start) {
                continue;
            }
            let mut stack: Vec<(CellId, usize)> = vec![(start, 0)];
            seen.insert(start);
            while let Some((node, i)) = stack.last_mut() {
                let node = *node;
                if *i < adj[&node].len() {
                    let w = adj[&node][*i];
                    *i += 1;
                    if seen.insert(w) {
                        stack.push((w, 0));
                    }
                } else {
                    order.push(node);
                    stack.pop();
                }
            }
        }
        order
    }

    fn make_ctx<'a>(&'a self, sheet_id: u32) -> EvalContext<'a> {
        EvalContext::new(&self.workbook, &self.values, self.clock.as_ref(), sheet_id)
    }

    /// Mark `id` dirty (when a formula) plus every transitive dependent.
    fn mark_dirty(&mut self, id: CellId) {
        if self.parsed.contains_key(&id) {
            self.dirty.insert(id);
        }
        self.mark_dependents_dirty(id);
    }

    /// BFS over reverse dependency edges, dirtying everything downstream.
    fn mark_dependents_dirty(&mut self, changed: CellId) {
        let mut queue = vec![changed];
        let mut seen: HashSet<CellId> = HashSet::from([changed]);
        while let Some(c) = queue.pop() {
            for dep_cell in graph::dependents_of(&c, &self.deps) {
                if seen.insert(dep_cell) {
                    self.dirty.insert(dep_cell);
                    queue.push(dep_cell);
                }
            }
        }
    }
}

impl Default for CalcEngine {
    fn default() -> Self {
        CalcEngine::new()
    }
}
