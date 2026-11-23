//! Logical functions (v2 §1): `logical/*.rs`, one file per function.
//!
//! Note: v2 names the IF file `logical/if.rs`; `if` is a Rust keyword,
//! so the file is `if_fn.rs` (recorded in `docs/adr/0001-v2-foundation.md`).

use calc_core::registry::Function;

mod and;
mod if_fn;
mod iferror;
mod not;
mod or;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("AND", and::call),
    ("IF", if_fn::call),
    ("IFERROR", iferror::call),
    ("NOT", not::call),
    ("OR", or::call),
];
