# ADR 0002 — v3 foundation: first-class reference values and cell metadata

Status: accepted (track F4, `feat/v3-references`)
Date: 2026-11-24

## Context

v3 adds the reference family — `OFFSET`, `INDIRECT`, the reference form
of `INDEX`, `ISREF`, `AREAS` — plus metadata functions
(`CELL`/`FORMULATEXT`/`ISFORMULA`/`SHEET`/`SHEETS`/`ADDRESS`). Their
specs (`docs/functions/{INDIRECT,OFFSET,INDEX,CELL,FORMULATEXT,
ISFORMULA,SHEET,SHEETS,ADDRESS,AREAS}.md`) require two capabilities the
v2 evaluator lacks:

1. A **reference object** a function can produce (`OFFSET(A1,1,1)`)
   and consume (`OFFSET`'s anchor argument must be a reference, not a
   value). Today `Expr::CellRef`/`Expr::RangeRef` evaluate eagerly to
   `ArgValue::Ref`/`ArgValue::Range` — geometry and sheet identity are
   discarded.
2. **Cell metadata**: stored formula text, formula-vs-literal, sheet
   ordinal/count, caller cell position.

Both must land without disturbing the ~100 registered functions or the
dependency graph's static tracking.

## Decisions

### `RefValue` + `Value::Reference`

- New `calc_core::reference::RefValue { sheet_id, range }` — a
  *resolved* single-area reference (normalized `RangeRef`), `Copy`,
  carrying no cell data. It is a value object; dereferencing reads the
  evaluator's current value snapshot.
- `Value::Reference(RefValue)` is a first-class `Value` variant, like
  `Value::Lambda`. Scalar coercions (`to_number`/`to_boolean`/
  `to_text`) yield `#VALUE!`: a reference that escapes dereferencing
  fails loudly rather than silently coercing.

### Two argument-evaluation paths

- `EvalContext::eval_arg` (unchanged semantics): when an expression's
  result is `Value::Reference`, it is **dereferenced immediately** to
  `ArgValue::Ref` (1x1) or `ArgValue::Range` — the same variants a
  written `A1`/`A1:B2` produces. All existing functions therefore see
  `SUM(OFFSET(...))` exactly like `SUM(A1:B2)` with zero changes.
- `EvalContext::eval_ref` (new): evaluates an argument *as a
  reference*. `CellRef`/`RangeRef` expressions resolve to geometry
  (`#REF!` for a missing sheet); other expressions are evaluated via
  the ref-preserving path and yield the `RefValue` when the result is
  `Value::Reference`, `#VALUE!` otherwise — Excel's "argument must be
  a reference" contract for `OFFSET`/`ISFORMULA`/`AREAS`.
- `EvalContext::deref(&RefValue)` is the single point where a
  reference turns back into cell data; sheet deletion → `#REF!`,
  over-limit ranges → `#VALUE!` (same as `range_values`).

### `INDIRECT` text parsing

`EvalContext::ref_from_a1_text` parses `ref_text` through the existing
`parse_sheet_qualified_ref` (sheet-qualified A1, quoted sheet names,
`$` markers) and resolves the sheet. Every failure — unparseable text,
text beyond `MAX_REF_TEXT_LEN` (8192, the engine's input bound for
runtime-parsed reference text), unknown sheet, out-of-grid
coordinates — is `#REF!` per the INDIRECT spec. Defined names and
R1C1 text are out of scope (SPEC-OPEN); `EvalContext::caller`
exposes the caller position those forms will need.

### Dependency-graph correctness

Cells read through `INDIRECT`/`OFFSET` **cannot** be statically
tracked — the target exists only at evaluation time, so no `Dep` edge
can represent it. The engine treats this honestly: such functions are
declared volatile (`FunctionRegistry::is_volatile`, the mechanism
built for `RAND`), so `CalcEngine` re-evaluates the containing cells
on every `recalculate()` pass and dirties their dependents.
`VOLATILE_NAMES` already lists `INDIRECT`/`OFFSET` ahead of their
implementations. This is conservative — it recalculates more than a
per-pass dependency re-registration scheme would — but correct;
narrower invalidation is future work and documented as such in
`mark_volatile_dirty` and SPEC-OPEN.

### Cell metadata

Read-only queries on `EvalContext` over the existing `Workbook`
model (no model changes): `cell_formula_text` (stored source, no `=`),
`cell_is_formula`, `sheet_count`, `sheet_name`, `sheet_index`, and
`caller` (the evaluated formula's `CellId`; `EvalContext::new` now
takes a `CellId` instead of a bare sheet id). These suffice for
`FORMULATEXT`, `ISFORMULA`, `SHEET`, `SHEETS`, and the `CELL` subset
(`"address"`/`"col"`/`"row"`/`"contents"`/`"type"`) without further
core changes.

## Consequences

- No `OFFSET`/`INDIRECT`/etc. are registered by this track; the
  mechanism is proven by a test-only registry in
  `crates/calc-core/tests/references.rs` exercising OFFSET-style,
  INDIRECT-style, and metadata functions end-to-end through the
  engine, including volatile recalculation of untracked targets.
- Deliberately deferred: union/multi-area references (`AREAS` counting
  `(A1:B2,C3:D4)` — needs the union operator), 3-D sheet-span
  references (`SHEETS(Sheet1:Sheet3!A1)`), defined names, R1C1, and
  reference propagation *through* lazy special forms (`IF` returning a
  reference — needs `IF`/`CHOOSE` to opt into `eval_ref`).
- `EvalContext::new` signature changed (`current_sheet: u32` →
  `caller: CellId`); `CalcEngine::make_ctx` passes the evaluated
  cell's id, `eval_formula` scratch evaluation anchors at `A1`.
