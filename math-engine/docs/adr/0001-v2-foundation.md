# ADR 0001 — v2 foundation: calc-functions crate, value model, coercion ownership

Status: accepted (PR00, v2 plan §3/§8.2)
Date: 2026-11-23

## Context

The v2 plan (`docs/FUNCTION_PLAN_V2.md`) scales the engine from the
Phase-1 13 functions to 100 across nine categories, developed in
parallel PRs. The flat `calc-core::functions` module and its built-in
dispatch could not serve that: every function PR would edit the same
registry file, and function code lived inside the core crate that is
meant to stay dependency-free.

## Decisions

### Crate separation and dispatch boundary

- New workspace crate `crates/calc-functions` holds all function
  implementations and the shared semantics layer (`common/`).
- `calc-core` exposes the dispatch boundary only:
  `registry::Function` (the call signature, receiving *unevaluated*
  argument `Expr`s so special forms stay lazy) and
  `registry::FunctionRegistry` (`lookup`/`dispatch`).
  `calc-core` does **not** depend on `calc-functions`.
- `EvalContext` and `CalcEngine` accept a `&dyn FunctionRegistry` /
  `Box<dyn FunctionRegistry>` injected by the caller
  (`CalcEngine::set_registry`). `CalcEngine::new()` defaults to
  `EmptyRegistry` (every call → `#NAME?`), so the core stays usable
  and testable alone.
- `calc-cli` is the composition root: it installs
  `calc_functions::default_registry()` on the engine. `calc-core`'s
  own integration tests do the same via a **dev-dependency** on
  `calc-functions` (dev-deps may form a cycle; the build graph for
  dependents is unaffected).

### Category layout and registry aggregation

- One file per function under its v2 §1 category directory
  (`aggregate/`, `logical/`, `math/`, `lookup/`, `text/`, `datetime/`,
  `statistics/`, `array/`, `functional/`). Each category `mod.rs`
  exports `pub const FUNCTIONS: &[(&str, Function)]`.
- `calc-functions/src/registry.rs` contains the single aggregation
  point `CATEGORIES`, with one entry per v2 §3 category — including
  categories that are still empty (`lookup`, `text`, `datetime`,
  `statistics`, `array`, `functional`). A function PR therefore adds
  one file plus one line in its category `mod.rs` and never touches
  `registry.rs`, which is what makes the v2 PR plan parallelizable.
- Lookup is a linear scan over the static lists (13 entries today).
  An index (`HashMap`/`phf`) is deferred to a performance PR.

### `if.rs` naming deviation

v2 §1 names the IF implementation `logical/if.rs`. `if` is a Rust
keyword and cannot be a module name, so the file is
`logical/if_fn.rs` (the module is `if_fn`, registered as `"IF"`).
This is the only v2 file name that cannot be used verbatim; any
future keyword collisions (e.g. `match.rs`, `loop.rs`) follow the
same `<name>_fn.rs` convention.

### Value model (v2 §3)

Target model: `Number / Text / Boolean / Blank / Error / Array /
Reference / Lambda`.

- **Exists today** (`calc_core::Value`): `Number(f64)`, `Text`,
  `Boolean`, `Blank`, `Error(CalcError)`, `Array(ArrayValue)`. NaN and
  infinities are normalized to `#NUM!`/`#DIV/0!`-class errors at
  operator boundaries. `ArgValue::{Scalar, Ref, Range}` carries the
  direct-vs-range coercion distinction; it is an argument wrapper,
  not a stored cell value.
- **Future**: first-class `Reference` (needed by `ROW`/`COLUMN`/
  `INDEX`-as-reference semantics) and `Lambda` (needed by
  `LET`/`LAMBDA`/`MAP`/`REDUCE`, PR12) are not yet represented and are
  deliberately deferred until their PRs; functions today see values,
  not reference objects.

### Date system

`Workbook::date_system()` already exposes `DateSystem` with the 1900
system as default and a 1904 field present. All serial↔calendar
conversion will live in `calc-functions::common::date_serial`
(declared, unimplemented) so the 1900 leap-year-bug compatibility and
the 1904 offset are owned in exactly one place; `EvalContext` already
passes `date_system()` through to functions.

### Coercion layer ownership

`calc-functions::common::coercion` owns Excel's implicit-conversion
rules (scalar `to_number`/`to_boolean` coercion vs range-member
ignoring). `calc-core` keeps only the primitive `Value` methods; no
function file may re-implement coercion. `parse_number_text` was
promoted to `pub` in `calc-core` for this reason — it is part of the
coercion contract, not a new rule.

### Dynamic arrays / spill

Spill (`#SPILL!`, atomic range writes, `FILTER`/`SORT`/`UNIQUE`/
`SEQUENCE`…) is explicitly **future work** (v2 PR10). `Value::Array`
exists as an argument/result type but nothing writes arrays into
cells yet; the current engine assigns one value per cell.

## Consequences

- `calc-core` remains std-only with zero dependencies; function work
  cannot destabilize the parser/evaluator crates.
- All existing tests keep passing; function unit tests moved with
  their files into `calc-functions`, and shared test support lives in
  `common::coercion::test_support`.
- Callers that want functions must now install a registry; forgetting
  yields `#NAME?`, a loud failure rather than a silent one.
