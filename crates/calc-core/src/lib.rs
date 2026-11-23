//! calc-core: spreadsheet formula parsing, dependency tracking and evaluation.
//!
//! Scope is the 38-function subset declared in `docs/IMPLEMENTATION_PLAN.md`.
//! Full Excel compatibility is an explicit non-goal; the declared subset is
//! specified, tested against reference implementations, and errors are
//! reported explicitly instead of being silently coerced.

pub fn engine_name() -> &'static str {
    "calc-core"
}
