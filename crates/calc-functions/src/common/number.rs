//! Number primitives (v2 §3) — **no code yet**.
//!
//! Intended role: shared numeric operations for the math category —
//! round-half-away-from-zero, `INT`/`TRUNC`/`MOD` semantics,
//! significance/mode rules for `CEILING.MATH`/`FLOOR.MATH`, and the
//! `#NUM!` boundary checks, so each `math/*.rs` file stays a thin spec
//! wrapper.
