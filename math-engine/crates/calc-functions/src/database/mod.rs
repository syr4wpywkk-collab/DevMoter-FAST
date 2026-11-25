//! Database functions (v3): `D*` aggregates over a rectangular range
//! with a header row, filtered by a criteria range. Shared argument
//! semantics live in [`crate::common::database`].
//!
//! To add a function: create `database/<name>.rs` with a `pub fn call`,
//! then add one `("<NAME>", <name>::call)` line to [`FUNCTIONS`].

use calc_core::registry::Function;

mod daverage;
mod dcount;
mod dcounta;
mod dget;
mod dmax;
mod dmin;
mod dproduct;
mod dstdev;
mod dstdevp;
mod dsum;
mod dvar;
mod dvarp;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("DAVERAGE", daverage::call),
    ("DCOUNT", dcount::call),
    ("DCOUNTA", dcounta::call),
    ("DGET", dget::call),
    ("DMAX", dmax::call),
    ("DMIN", dmin::call),
    ("DPRODUCT", dproduct::call),
    ("DSTDEV", dstdev::call),
    ("DSTDEVP", dstdevp::call),
    ("DSUM", dsum::call),
    ("DVAR", dvar::call),
    ("DVARP", dvarp::call),
];
