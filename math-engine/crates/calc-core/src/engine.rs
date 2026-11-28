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
//! `recalculate` call (a rerun of dynamic references gets its own):
//! exceeding it aborts with [`EngineError::Eval`], leaving un-evaluated
//! cells dirty.

use std::collections::{HashMap, HashSet};
use std::fmt;

use crate::ast::Expr;
use crate::cell::CellId;
use crate::cell::CellRef;
use crate::cell::RangeRef;
use crate::error::CalcError;
use crate::eval::{Clock, EvalContext, EvalError, RngSource, SplitMix64, SystemClock};
use crate::graph::{self, Dep};
use crate::parser::{ParseError, parse};
use crate::registry::{EmptyRegistry, FunctionRegistry};
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

/// Maximum number of dirty-drain passes inside one
/// [`CalcEngine::recalculate`]. Spill writes can dirty dependents of
/// interior cells after they were already evaluated; each pass makes
/// progress or stops, so a small bound suffices against spill feedback
/// loops (a formula whose spilled value feeds back into its own result).
/// Cells still dirty at the bound stay dirty.
pub const MAX_RECALC_PASSES: usize = 128;

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
    /// Spill rectangles owned by each anchor formula cell: anchor ->
    /// (rows, cols) of the region it writes below/right of itself.
    spills: HashMap<CellId, (u32, u32)>,
    /// Reverse index: spilled cell -> the anchor that owns it. Entries
    /// exist only for cells inside a spill rectangle (never the anchor).
    spilled_by: HashMap<CellId, CellId>,
    /// Reverse dependency index for `Dep::Cell` edges: referenced cell ->
    /// the formula cells that read it. Lets `mark_dependents_dirty` find
    /// direct dependents in O(out-degree) instead of scanning `deps`.
    rev_cells: HashMap<CellId, HashSet<CellId>>,
    /// Formulas holding `Dep::Range` edges, indexed by the *referenced*
    /// sheet: watcher -> normalized ranges. Dirty propagation scans the
    /// watchers of the changed cell's sheet only — proportional to the
    /// range-dep count, not the total formula count.
    range_watchers: HashMap<u32, HashMap<CellId, Vec<RangeRef>>>,
    /// Formula cells whose AST contains a volatile call (per
    /// [`FunctionRegistry::is_volatile`]). Maintained incrementally by
    /// `set_cell`/`clear_cell`/`set_registry` so each `recalculate()`
    /// pass needn't rescan every parsed formula.
    volatile: HashSet<CellId>,
    /// An input changed since volatile cells last ran: reads
    /// (`get_value`/`eval_formula`) refresh them only then, so reading a
    /// `RAND()` twice gives the same value (like Excel).
    volatile_stale: bool,
    clock: Box<dyn Clock>,
    rng: Box<dyn RngSource>,
    registry: Box<dyn FunctionRegistry>,
}

impl CalcEngine {
    /// Engine over an empty workbook with the system clock.
    pub fn new() -> CalcEngine {
        CalcEngine::with_workbook(Workbook::new())
    }

    /// Engine over an existing workbook with the system clock and a
    /// `SplitMix64` RNG seeded from `workbook.rng_seed()`.
    pub fn with_workbook(workbook: Workbook) -> CalcEngine {
        let rng = Box::new(SplitMix64::new(workbook.rng_seed()));
        CalcEngine {
            workbook,
            parsed: HashMap::new(),
            deps: HashMap::new(),
            values: HashMap::new(),
            dirty: HashSet::new(),
            spills: HashMap::new(),
            spilled_by: HashMap::new(),
            rev_cells: HashMap::new(),
            range_watchers: HashMap::new(),
            volatile: HashSet::new(),
            volatile_stale: false,
            clock: Box::new(SystemClock),
            rng,
            registry: Box::new(EmptyRegistry),
        }
    }

    /// Inject a clock for volatile functions (plan §5). Replaces the
    /// default [`SystemClock`].
    pub fn set_clock(&mut self, clock: Box<dyn Clock>) {
        self.clock = clock;
        self.volatile_stale = true;
    }

    /// Inject the random source for volatile `RAND`-family functions.
    /// Replaces the default `SplitMix64` seeded per workbook.
    pub fn set_rng(&mut self, rng: Box<dyn RngSource>) {
        self.rng = rng;
        self.volatile_stale = true;
    }

    /// Inject the function registry used to dispatch `Expr::Call` nodes
    /// (v2 plan §3). Replaces the default [`EmptyRegistry`], under which
    /// every function call evaluates to `#NAME?`. `calc-cli` and
    /// `calc-wasm` install `calc_functions::default_registry()` here.
    ///
    /// Volatility is a registry property, so the volatile-cell set is
    /// rebuilt here (a one-off O(#formulas) pass).
    pub fn set_registry(&mut self, registry: Box<dyn FunctionRegistry>) {
        self.volatile = self
            .parsed
            .iter()
            .filter_map(|(id, expr)| expr_is_volatile(expr, registry.as_ref()).then_some(*id))
            .collect();
        self.registry = registry;
        self.volatile_stale = true;
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

        // Typing into a cell covered by another anchor's spill makes it
        // an obstruction: re-evaluate that anchor so it releases its
        // spill and reports `#SPILL!`.
        if let Some(&anchor) = self.spilled_by.get(&id) {
            if self.parsed.contains_key(&anchor) {
                self.dirty.insert(anchor);
            }
        }

        match input {
            CellInput::Formula(text) => {
                // Parse before mutating anything.
                let expr = parse(&text)?;
                let deps =
                    graph::extract_deps(&expr, &self.workbook, sheet_id, self.registry.as_ref());
                self.workbook
                    .set_cell(sheet_id, r.row, r.col, CellInput::Formula(text))?;
                self.deindex_deps(id);
                if expr_is_volatile(&expr, self.registry.as_ref()) {
                    self.volatile.insert(id);
                } else {
                    self.volatile.remove(&id);
                }
                self.parsed.insert(id, expr);
                self.deps.insert(id, deps);
                self.index_deps(id);
            }
            CellInput::Value(v) => {
                self.values.insert(id, v.clone());
                self.workbook
                    .set_cell(sheet_id, r.row, r.col, CellInput::Value(v))?;
                self.parsed.remove(&id);
                self.deindex_deps(id);
                self.volatile.remove(&id);
                self.dirty.remove(&id);
                // No longer a formula: release any spill it owned.
                for c in self.release_spill(id).into_keys() {
                    self.mark_dependents_dirty(c);
                }
            }
        }
        self.mark_dirty(id);
        self.volatile_stale = true;
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
        self.deindex_deps(id);
        self.volatile.remove(&id);
        self.values.remove(&id);
        self.dirty.remove(&id);
        // Clearing inside another anchor's spill: drop the read-through
        // value and re-evaluate the anchor so the spill is rewritten
        // (or downgraded to `#SPILL!` if the anchor is now obstructed).
        if let Some(&anchor) = self.spilled_by.get(&id) {
            self.spilled_by.remove(&id);
            if self.parsed.contains_key(&anchor) {
                self.dirty.insert(anchor);
            }
        }
        // Clearing an anchor releases its whole spill.
        for c in self.release_spill(id).into_keys() {
            self.mark_dependents_dirty(c);
        }
        self.mark_dependents_dirty(id);
        self.volatile_stale = true;
        Ok(())
    }

    /// Current value of a cell, recalculating first if needed.
    pub fn get_value(&mut self, sheet: &str, address: &str) -> Result<Value, EngineError> {
        let sheet_id = self
            .workbook
            .sheet_id(sheet)
            .ok_or(WorkbookError::SheetNotFound)?;
        let r = CellRef::from_a1(address).map_err(WorkbookError::BadAddress)?;
        self.recalculate_pending()?;
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
        self.recalculate_pending()?;
        let expr = parse(formula)?;
        let mut ctx = self.make_ctx(CellId {
            sheet_id,
            row: 0,
            col: 0,
        });
        Ok(cell_boundary_value(ctx.eval(&expr)?))
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
    ///
    /// A formula whose result is a `Value::Array` *spills*: the array's
    /// elements are written as read-through values into the rectangle
    /// below/right of the anchor, and dependents of those cells are
    /// re-dirtied. Since that may dirty cells already visited this pass,
    /// evaluation runs in passes until the dirty set drains (bounded by
    /// [`MAX_RECALC_PASSES`] against pathological spill feedback).
    ///
    /// Volatile cells (RAND, RANDBETWEEN, TODAY, NOW per the registry)
    /// rerun on every explicit `recalculate()`; reads only rerun them
    /// after an input changed.
    pub fn recalculate(&mut self) -> Result<RecalcReport, EngineError> {
        self.volatile_stale = true;
        self.recalculate_pending()
    }

    /// Recalculate before a read: dirty cells, plus volatile cells only
    /// if an input changed since they last ran. Volatile cells without a
    /// random/clock call (`INDIRECT`, `OFFSET`) are deterministic, so they
    /// rerun on every read to pick up targets evaluated after them or
    /// sheets added since.
    fn recalculate_pending(&mut self) -> Result<RecalcReport, EngineError> {
        let mut report = RecalcReport::default();
        if std::mem::take(&mut self.volatile_stale) {
            self.mark_volatile_dirty();
        } else {
            let dynamic: Vec<CellId> = self
                .volatile
                .iter()
                .filter(|id| {
                    self.is_dynamic(id)
                        && !matches!(self.values.get(id), Some(Value::Error(CalcError::Circ)))
                })
                .copied()
                .collect();
            self.dirty.extend(dynamic);
        }
        // A dynamic reference can read a formula evaluated after it in the
        // same pass (no static edge orders them): rerun those once more.
        let mut reran_dynamic = false;
        let mut budget_base = 0;
        for _ in 0..MAX_RECALC_PASSES {
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
            let mut early_dynamic = Vec::new();
            let mut evaluated_any = false;

            for id in order {
                if !self.dirty.contains(&id) {
                    continue;
                }
                if self.is_dynamic(&id) {
                    early_dynamic.push(id);
                } else if !early_dynamic.is_empty() {
                    evaluated_any = true;
                }
                let expr = self.parsed[&id].clone();
                // Release the old spill *before* evaluating so the
                // formula sees its own previous output as blank (e.g.
                // `=SUM(C2:D3)` replacing a spiller must not read its
                // stale spilled values).
                let old = self.release_spill(id);
                let before = self
                    .volatile
                    .contains(&id)
                    .then(|| self.values.get(&id).cloned());
                let (value, steps) = {
                    let mut ctx = self.make_ctx(id);
                    let v = ctx.eval(&expr)?;
                    (v, ctx.steps())
                };
                report.steps += steps;
                if report.steps - budget_base > crate::eval::MAX_EVAL_STEPS {
                    return Err(EngineError::Eval(EvalError::StepBudgetExceeded));
                }
                for c in self.apply_result(id, value, old) {
                    self.mark_dependents_dirty(c);
                }
                // A rerun volatile cell's dependents were not dirtied up
                // front: re-dirty them when its value changed.
                if before.is_some_and(|b| b.as_ref() != self.values.get(&id)) {
                    self.mark_dependents_dirty(id);
                }
                self.dirty.remove(&id);
                report.evaluated.push(id);
            }
            if evaluated_any && !reran_dynamic {
                reran_dynamic = true;
                budget_base = report.steps;
                self.dirty.extend(early_dynamic);
            }
        }
        Ok(report)
    }

    /// A volatile formula without a random/clock call (`INDIRECT`,
    /// `OFFSET`): deterministic, but its targets are unknown statically.
    fn is_dynamic(&self, id: &CellId) -> bool {
        self.volatile.contains(id)
            && self.parsed.get(id).is_some_and(|e| {
                !expr_calls(e, &|n| {
                    NONDETERMINISTIC.iter().any(|f| f.eq_ignore_ascii_case(n))
                })
            })
    }

    /// Store a formula result for `id`, handling spill bookkeeping.
    ///
    /// An array result spills into the `rows x cols` rectangle starting
    /// at `id`: the anchor keeps the top-left element (matching Excel's
    /// implicit-intersection view of the anchor) and every other cell
    /// gets a read-through value. The write is atomic: any stored cell
    /// or foreign spill inside the rectangle, or a rectangle running off
    /// the grid, makes the anchor `#SPILL!` and nothing is written.
    ///
    /// Returns the *spill-interior* cells whose value changed (compared
    /// against `old`, captured by [`Self::release_spill`]); their
    /// dependents must be re-dirtied (they are not reachable through
    /// `id`'s own dependency edges).
    fn apply_result(
        &mut self,
        id: CellId,
        value: Value,
        mut old: HashMap<CellId, Value>,
    ) -> Vec<CellId> {
        let Value::Array(a) = value else {
            self.values.insert(id, value.normalize_zero());
            return old.into_keys().collect();
        };

        let (rows, cols) = (a.rows(), a.cols());
        let fits = u64::from(id.row) + u64::from(rows) <= u64::from(crate::cell::MAX_ROWS)
            && u64::from(id.col) + u64::from(cols) <= u64::from(crate::cell::MAX_COLS);
        let blocked = (0..rows).any(|dr| {
            (0..cols).any(|dc| {
                if dr == 0 && dc == 0 {
                    return false;
                }
                let c = CellId {
                    sheet_id: id.sheet_id,
                    row: id.row + dr,
                    col: id.col + dc,
                };
                // A stored cell (value or formula) is an obstruction, as
                // is territory owned by another anchor's spill.
                self.workbook.cell(c.sheet_id, c.row, c.col).is_some()
                    || self.spilled_by.contains_key(&c)
            })
        });
        if !fits || blocked {
            self.values.insert(id, Value::Error(CalcError::Spill));
            return old.into_keys().collect();
        }

        self.spills.insert(id, (rows, cols));
        self.values.insert(
            id,
            a.get(0, 0)
                .cloned()
                .unwrap_or(Value::Blank)
                .normalize_zero(),
        );
        let mut changed = Vec::new();
        for dr in 0..rows {
            for dc in 0..cols {
                if dr == 0 && dc == 0 {
                    continue;
                }
                let c = CellId {
                    sheet_id: id.sheet_id,
                    row: id.row + dr,
                    col: id.col + dc,
                };
                let v = a
                    .get(dr, dc)
                    .cloned()
                    .unwrap_or(Value::Blank)
                    .normalize_zero();
                if old.remove(&c).unwrap_or(Value::Blank) != v {
                    changed.push(c);
                }
                self.values.insert(c, v);
                self.spilled_by.insert(c, id);
            }
        }
        // Cells covered by the old spill but not the new one read blank
        // now; their dependents need re-evaluation too.
        changed.extend(old.into_keys());
        changed
    }

    /// Release the spill owned by `anchor` (if any): clears the
    /// `spilled_by` index and the read-through values (a covered cell
    /// that gained a stored input keeps its own value). Returns the
    /// removed `(cell, old value)` pairs — used by `apply_result` for
    /// change detection and by `set_cell`/`clear_cell` to find cells
    /// whose dependents read `Blank` now.
    fn release_spill(&mut self, anchor: CellId) -> HashMap<CellId, Value> {
        let mut old = HashMap::new();
        if let Some((rows, cols)) = self.spills.remove(&anchor) {
            for dr in 0..rows {
                for dc in 0..cols {
                    if dr == 0 && dc == 0 {
                        continue;
                    }
                    let c = CellId {
                        sheet_id: anchor.sheet_id,
                        row: anchor.row + dr,
                        col: anchor.col + dc,
                    };
                    if self.spilled_by.remove(&c).is_none()
                        || self.workbook.cell(c.sheet_id, c.row, c.col).is_some()
                    {
                        continue;
                    }
                    if let Some(v) = self.values.remove(&c) {
                        old.insert(c, v);
                    }
                }
            }
        }
        old
    }

    /// Dirty formula cells in dependency-first order (a cell always sorts
    /// after the dirty cells it depends on): post-order DFS over dep edges
    /// restricted to the dirty set.
    fn topo_order(&self) -> Vec<CellId> {
        let dirty = &self.dirty;
        // Adjacency within the dirty set (same expansion as the SCC pass):
        // range edges resolve through a sorted member index instead of
        // scanning the whole dirty set per edge.
        let by_sheet = graph::sorted_by_sheet(dirty);
        let mut adj: HashMap<CellId, Vec<CellId>> = HashMap::with_capacity(dirty.len());
        for &c in dirty {
            let mut edges = Vec::new();
            for dep in self.deps.get(&c).into_iter().flatten() {
                match dep {
                    Dep::Cell(t) if dirty.contains(t) => edges.push(*t),
                    Dep::Range { sheet_id, range } => {
                        if let Some(sorted) = by_sheet.get(sheet_id) {
                            edges.extend(graph::members_in_range(sorted, range));
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

    /// Dirty every volatile formula cell (per
    /// `FunctionRegistry::is_volatile`, maintained in `self.volatile`)
    /// plus its transitive dependents — a fresh `RAND()` is a value
    /// change like any other, so downstream formulas must re-run too.
    ///
    /// This is also the engine's answer to *dynamic* references:
    /// `INDIRECT`/`OFFSET`-style calls produce their target reference
    /// at evaluation time, so no static `Dep` edge can exist for the
    /// cells they read. Marking every formula containing them volatile
    /// recalculates them on every pass, which is conservative but
    /// correct — the alternative (pretending static deps exist) would
    /// miss updates. A narrower invalidation scheme (re-registering
    /// deps per pass) is future work; see ADR 0002.
    fn mark_volatile_dirty(&mut self) {
        let volatile: Vec<CellId> = self.volatile.iter().copied().collect();
        for id in volatile {
            if self.parsed.contains_key(&id) {
                self.dirty.insert(id);
            }
            self.mark_dependents_dirty(id);
        }
    }

    /// Add `id`'s current dep edges to the reverse indexes.
    fn index_deps(&mut self, id: CellId) {
        for dep in self.deps.get(&id).into_iter().flatten() {
            match dep {
                Dep::Cell(t) => {
                    self.rev_cells.entry(*t).or_default().insert(id);
                }
                Dep::Range { sheet_id, range } => {
                    self.range_watchers
                        .entry(*sheet_id)
                        .or_default()
                        .entry(id)
                        .or_default()
                        .push(*range);
                }
            }
        }
    }

    /// Remove `id`'s dep edges from `deps` and both reverse indexes.
    fn deindex_deps(&mut self, id: CellId) {
        let Some(deps) = self.deps.remove(&id) else {
            return;
        };
        for dep in deps {
            match dep {
                Dep::Cell(t) => {
                    if let Some(set) = self.rev_cells.get_mut(&t) {
                        set.remove(&id);
                        if set.is_empty() {
                            self.rev_cells.remove(&t);
                        }
                    }
                }
                Dep::Range { sheet_id, .. } => {
                    if let Some(watchers) = self.range_watchers.get_mut(&sheet_id) {
                        watchers.remove(&id);
                        if watchers.is_empty() {
                            self.range_watchers.remove(&sheet_id);
                        }
                    }
                }
            }
        }
    }

    fn make_ctx<'a>(&'a self, caller: CellId) -> EvalContext<'a> {
        EvalContext::new(
            &self.workbook,
            &self.values,
            self.clock.as_ref(),
            self.rng.as_ref(),
            self.registry.as_ref(),
            caller,
        )
    }

    /// Mark `id` dirty (when a formula) plus every transitive dependent.
    fn mark_dirty(&mut self, id: CellId) {
        if self.parsed.contains_key(&id) {
            self.dirty.insert(id);
        }
        self.mark_dependents_dirty(id);
    }

    /// BFS over reverse dependency edges, dirtying everything downstream.
    /// Direct dependents come from `rev_cells` (O(out-degree)); range-dep
    /// formulas are found by scanning `range_watchers` on the changed
    /// cell's sheet — proportional to the number of range-dep formulas,
    /// not the total formula count.
    fn mark_dependents_dirty(&mut self, changed: CellId) {
        let mut queue = vec![changed];
        let mut seen: HashSet<CellId> = HashSet::from([changed]);
        while let Some(c) = queue.pop() {
            if let Some(set) = self.rev_cells.get(&c) {
                for &dep_cell in set {
                    if seen.insert(dep_cell) {
                        self.dirty.insert(dep_cell);
                        queue.push(dep_cell);
                    }
                }
            }
            if let Some(watchers) = self.range_watchers.get(&c.sheet_id) {
                for (watcher, ranges) in watchers {
                    if ranges.iter().any(|r| r.contains(c.row, c.col)) && seen.insert(*watcher) {
                        self.dirty.insert(*watcher);
                        queue.push(*watcher);
                    }
                }
            }
        }
    }
}

/// Volatile functions whose result changes without any input change.
const NONDETERMINISTIC: [&str; 5] = ["RAND", "RANDBETWEEN", "RANDARRAY", "NOW", "TODAY"];

/// Does `expr` contain a call the registry marks volatile?
fn expr_is_volatile(expr: &Expr, registry: &dyn FunctionRegistry) -> bool {
    expr_calls(expr, &|name| registry.is_volatile(name))
}

/// Does `expr` contain a call to a function matching `pred`?
fn expr_calls(expr: &Expr, pred: &dyn Fn(&str) -> bool) -> bool {
    match expr {
        Expr::Literal(_)
        | Expr::Missing
        | Expr::Name(_)
        | Expr::CellRef { .. }
        | Expr::RangeRef { .. } => false,
        Expr::Unary { operand, .. } | Expr::Percent(operand) => expr_calls(operand, pred),
        Expr::Binary { left, right, .. } => expr_calls(left, pred) || expr_calls(right, pred),
        Expr::Call { name, args } => pred(name) || args.iter().any(|a| expr_calls(a, pred)),
        Expr::ArrayLiteral(rows) => rows.iter().flatten().any(|a| expr_calls(a, pred)),
        Expr::Invoke { callee, args } => {
            expr_calls(callee, pred) || args.iter().any(|a| expr_calls(a, pred))
        }
    }
}

impl Default for CalcEngine {
    fn default() -> Self {
        CalcEngine::new()
    }
}

/// A lambda that reaches a cell boundary cannot be displayed; per the
/// value-model spec (`docs/functions/LAMBDA.md`) it becomes `#VALUE!`
/// (SPEC-OPEN: Excel shows `#CALC!` for an uncalled LAMBDA).
fn cell_boundary_value(v: Value) -> Value {
    match v {
        Value::Lambda(_) => Value::Error(CalcError::Value),
        // The evaluator dereferences references before they can reach a
        // cell boundary; this arm is defensive for manually-constructed
        // evaluation paths.
        Value::Reference(_) => Value::Error(CalcError::Value),
        v => v,
    }
}
