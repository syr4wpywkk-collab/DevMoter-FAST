//! Logical functions (v2 §1): `logical/*.rs`, one file per function.
//!
//! Note: v2 names the IF file `logical/if.rs`; `if` is a Rust keyword,
//! so the file is `if_fn.rs` (recorded in `docs/adr/0001-v2-foundation.md`).

use calc_core::registry::Function;

mod and;
mod bycol;
mod byrow;
mod false_fn;
mod if_fn;
mod iferror;
mod ifna;
mod ifs;
mod isnumber;
mod istext;
mod makearray;
mod not;
mod or;
mod scan;
mod switch;
mod true_fn;
mod xor;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("AND", and::call),
    ("BYCOL", bycol::call),
    ("BYROW", byrow::call),
    ("FALSE", false_fn::call),
    ("IF", if_fn::call),
    ("IFERROR", iferror::call),
    ("IFNA", ifna::call),
    ("IFS", ifs::call),
    ("ISNUMBER", isnumber::call),
    ("ISTEXT", istext::call),
    ("MAKEARRAY", makearray::call),
    ("NOT", not::call),
    ("OR", or::call),
    ("SCAN", scan::call),
    ("SWITCH", switch::call),
    ("TRUE", true_fn::call),
    ("XOR", xor::call),
];
