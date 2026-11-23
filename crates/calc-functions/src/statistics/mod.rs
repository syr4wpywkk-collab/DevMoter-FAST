//! Statistics functions (v2 §1): `statistics/*.rs`, one file per
//! function. Shared numeric kernels live in [`crate::common::statistics`].
//!
//! To add a function: create `statistics/<name>.rs` with a `pub fn call`,
//! then add one `("<NAME>", <name>::call)` line to [`FUNCTIONS`].

use calc_core::registry::Function;

mod correl;
mod intercept;
mod large;
mod median;
mod mode_sngl;
mod percentile_inc;
mod quartile_inc;
mod rank_eq;
mod slope;
mod small;
mod stdev_s;
mod var_s;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("CORREL", correl::call),
    ("INTERCEPT", intercept::call),
    ("LARGE", large::call),
    ("MEDIAN", median::call),
    ("MODE.SNGL", mode_sngl::call),
    ("PERCENTILE.INC", percentile_inc::call),
    ("QUARTILE.INC", quartile_inc::call),
    ("RANK.EQ", rank_eq::call),
    ("SLOPE", slope::call),
    ("SMALL", small::call),
    ("STDEV.S", stdev_s::call),
    ("VAR.S", var_s::call),
];
