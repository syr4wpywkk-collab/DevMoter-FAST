//! Lookup functions (v2 §1): `lookup/*.rs`, one file per function.
//! Shared match/search semantics live in [`crate::common::lookup`].

use calc_core::registry::Function;

mod choose;
mod column;
mod columns;
mod hlookup;
mod index;
mod lookup_fn;
mod match_fn;
mod row;
mod rows;
mod vlookup;
mod xlookup;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
///
/// File-name deviations from `docs/FUNCTION_PLAN_V2.md` §1 (same
/// convention as `logical/if_fn.rs`): `match` is a Rust keyword, and a
/// `lookup` module inside `lookup/` trips `clippy::module_inception`,
/// so the files are `match_fn.rs` and `lookup_fn.rs`.
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("CHOOSE", choose::call),
    ("COLUMN", column::call),
    ("COLUMNS", columns::call),
    ("HLOOKUP", hlookup::call),
    ("INDEX", index::call),
    ("LOOKUP", lookup_fn::call),
    ("MATCH", match_fn::call),
    ("ROW", row::call),
    ("ROWS", rows::call),
    ("VLOOKUP", vlookup::call),
    ("XLOOKUP", xlookup::call),
];
