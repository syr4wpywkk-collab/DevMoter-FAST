//! Aggregate functions (v2 §1): `aggregate/*.rs`, one file per function.
//!
//! To add a function: create `aggregate/<name>.rs` with a `pub fn call`,
//! then add one `("<NAME>", <name>::call)` line to [`FUNCTIONS`].

use calc_core::registry::Function;

mod average;
mod count;
mod counta;
mod countif;
mod countifs;
mod max;
mod min;
mod product;
mod sum;
mod sumif;
mod sumifs;
mod sumproduct;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("AVERAGE", average::call),
    ("COUNT", count::call),
    ("COUNTA", counta::call),
    ("COUNTIF", countif::call),
    ("COUNTIFS", countifs::call),
    ("MAX", max::call),
    ("MIN", min::call),
    ("PRODUCT", product::call),
    ("SUM", sum::call),
    ("SUMIF", sumif::call),
    ("SUMIFS", sumifs::call),
    ("SUMPRODUCT", sumproduct::call),
];
