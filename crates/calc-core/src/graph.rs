//! Static dependency graph for formula cells (plan §5).
//!
//! [`Dep`] records what a formula reads: either a single cell or a
//! rectangular range on a resolved sheet. [`extract_deps`] walks an AST and
//! collects every referenced target — including references inside branches
//! that lazy evaluation may skip, per plan §5 (動的依存最適化は後回し).
//!
//! [`cycle_members`] finds every cell participating in a dependency cycle
//! via Tarjan's strongly-connected-components algorithm; members evaluate
//! to [`crate::error::CalcError::Circ`] and their dependents see the error propagate
//! through normal reference evaluation.

use std::collections::{HashMap, HashSet};

use crate::ast::Expr;
use crate::cell::{CellId, RangeRef};
use crate::workbook::Workbook;

/// One dependency target of a formula cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dep {
    /// A single referenced cell.
    Cell(CellId),
    /// A rectangular range on a sheet (normalized: start <= end).
    Range { sheet_id: u32, range: RangeRef },
}

impl Dep {
    /// Does this dependency cover `cell`?
    pub fn contains(&self, cell: &CellId) -> bool {
        match self {
            Dep::Cell(c) => c == cell,
            Dep::Range { sheet_id, range } => {
                *sheet_id == cell.sheet_id && range.contains(cell.row, cell.col)
            }
        }
    }
}

/// Collect all reference targets of `expr`, resolving sheet names against
/// `workbook`. References on unresolvable sheets are dropped — they
/// evaluate to `#REF!` and can never change.
pub fn extract_deps(expr: &Expr, workbook: &Workbook, current_sheet: u32) -> Vec<Dep> {
    let mut out = Vec::new();
    collect(expr, workbook, current_sheet, &mut out);
    out
}

fn collect(expr: &Expr, wb: &Workbook, current_sheet: u32, out: &mut Vec<Dep>) {
    let resolve = |sheet: &Option<String>| -> Option<u32> {
        match sheet {
            None => Some(current_sheet),
            Some(name) => wb.sheet_id(name),
        }
    };
    match expr {
        Expr::Literal(_) | Expr::Missing | Expr::Name(_) => {}
        Expr::Unary { operand, .. } | Expr::Percent(operand) => {
            collect(operand, wb, current_sheet, out)
        }
        Expr::Binary { left, right, .. } => {
            collect(left, wb, current_sheet, out);
            collect(right, wb, current_sheet, out);
        }
        Expr::Call { args, .. } => {
            for a in args {
                collect(a, wb, current_sheet, out);
            }
        }
        Expr::Invoke { callee, args } => {
            collect(callee, wb, current_sheet, out);
            for a in args {
                collect(a, wb, current_sheet, out);
            }
        }
        Expr::ArrayLiteral(rows) => {
            for a in rows.iter().flatten() {
                collect(a, wb, current_sheet, out);
            }
        }
        Expr::CellRef { sheet, cell } => {
            if let Some(sheet_id) = resolve(sheet) {
                out.push(Dep::Cell(CellId {
                    sheet_id,
                    row: cell.row,
                    col: cell.col,
                }));
            }
        }
        Expr::RangeRef { sheet, range } => {
            if let Some(sheet_id) = resolve(sheet) {
                out.push(Dep::Range {
                    sheet_id,
                    range: range.normalized(),
                });
            }
        }
    }
}

/// Every formula cell in `deps` whose dep list contains `changed`.
pub fn dependents_of(changed: &CellId, deps: &HashMap<CellId, Vec<Dep>>) -> Vec<CellId> {
    deps.iter()
        .filter_map(|(cell, targets)| targets.iter().any(|d| d.contains(changed)).then_some(*cell))
        .collect()
}

/// All cells participating in a dependency cycle among `cells`.
///
/// Runs Tarjan's SCC algorithm (iterative, so deep graphs cannot overflow
/// the call stack) over the subgraph induced by `cells` — typically the
/// dirty formula cells — with edges `cell -> referenced cell`. An SCC is
/// cyclic when it has more than one member or contains a self-loop.
///
/// Cells *depending on* a cycle but not in it are not returned; they pick
/// up [`crate::error::CalcError::Circ`] through ordinary error propagation.
pub fn cycle_members(cells: &HashSet<CellId>, deps: &HashMap<CellId, Vec<Dep>>) -> HashSet<CellId> {
    // Adjacency restricted to edges between member cells. Range deps are
    // resolved by containment against the member set, which keeps the cost
    // proportional to the member count rather than the range size.
    let mut adj: HashMap<CellId, Vec<CellId>> = HashMap::with_capacity(cells.len());
    for &cell in cells {
        let mut edges = Vec::new();
        if let Some(targets) = deps.get(&cell) {
            for dep in targets {
                match dep {
                    Dep::Cell(c) => {
                        if cells.contains(c) {
                            edges.push(*c);
                        }
                    }
                    Dep::Range { sheet_id, range } => {
                        for m in cells {
                            if m.sheet_id == *sheet_id && range.contains(m.row, m.col) {
                                edges.push(*m);
                            }
                        }
                    }
                }
            }
        }
        adj.insert(cell, edges);
    }

    let mut t = Tarjan {
        adj: &adj,
        index: HashMap::new(),
        lowlink: HashMap::new(),
        on_stack: HashSet::new(),
        stack: Vec::new(),
        next: 0,
        cyclic: HashSet::new(),
    };
    for &cell in cells {
        if !t.index.contains_key(&cell) {
            t.strong_connect(cell);
        }
    }
    t.cyclic
}

struct Tarjan<'a> {
    adj: &'a HashMap<CellId, Vec<CellId>>,
    index: HashMap<CellId, usize>,
    lowlink: HashMap<CellId, usize>,
    on_stack: HashSet<CellId>,
    stack: Vec<CellId>,
    next: usize,
    cyclic: HashSet<CellId>,
}

impl Tarjan<'_> {
    /// Iterative Tarjan visit; each work-list frame is (node, next edge).
    fn strong_connect(&mut self, v: CellId) {
        let mut work: Vec<(CellId, usize)> = Vec::new();
        self.visit(v, &mut work);
        while let Some((node, edge_i)) = work.last_mut() {
            let node = *node;
            let edges = &self.adj[&node];
            if *edge_i < edges.len() {
                let w = edges[*edge_i];
                *edge_i += 1;
                if !self.index.contains_key(&w) {
                    self.visit(w, &mut work);
                } else if self.on_stack.contains(&w) {
                    let lw = self.lowlink[&w];
                    let ln = self.lowlink.get_mut(&node).unwrap();
                    *ln = (*ln).min(lw);
                }
            } else {
                work.pop();
                if let Some(&(parent, _)) = work.last() {
                    let ln = self.lowlink[&node];
                    let lp = self.lowlink.get_mut(&parent).unwrap();
                    *lp = (*lp).min(ln);
                }
                if self.lowlink[&node] == self.index[&node] {
                    self.emit_scc(node);
                }
            }
        }
    }

    fn visit(&mut self, v: CellId, work: &mut Vec<(CellId, usize)>) {
        self.index.insert(v, self.next);
        self.lowlink.insert(v, self.next);
        self.next += 1;
        self.stack.push(v);
        self.on_stack.insert(v);
        work.push((v, 0));
    }

    fn emit_scc(&mut self, root: CellId) {
        let mut scc = Vec::new();
        while let Some(w) = self.stack.pop() {
            self.on_stack.remove(&w);
            scc.push(w);
            if w == root {
                break;
            }
        }
        if scc.len() > 1 || self.adj[&root].contains(&root) {
            self.cyclic.extend(scc);
        }
    }
}
