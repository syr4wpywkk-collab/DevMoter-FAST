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
mod quartile_exc;
mod quartile_inc;
mod rank_avg;
mod rank_eq;
mod rsq;
mod skew;
mod skew_p;
mod slope;
mod small;
mod standardize;
mod stdev_p;
mod stdev_s;
mod stdeva;
mod stdevpa;
mod steyx;
mod t_dist;
mod t_dist_2t;
mod t_dist_rt;
mod t_inv;
mod t_inv_2t;
mod t_test;
mod trend;
mod trimmean;
mod var_p;
mod var_s;
mod vara;
mod varpa;
mod weibull_dist;
mod z_test;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("CORREL", correl::call),
    ("INTERCEPT", intercept::call),
    ("LARGE", large::call),
    ("MEDIAN", median::call),
    ("MODE.SNGL", mode_sngl::call),
    ("PERCENTILE.INC", percentile_inc::call),
    ("QUARTILE.EXC", quartile_exc::call),
    ("QUARTILE.INC", quartile_inc::call),
    ("RANK.AVG", rank_avg::call),
    ("RANK.EQ", rank_eq::call),
    ("RSQ", rsq::call),
    ("SKEW", skew::call),
    ("SKEW.P", skew_p::call),
    ("SLOPE", slope::call),
    ("SMALL", small::call),
    ("STANDARDIZE", standardize::call),
    ("STDEV.P", stdev_p::call),
    ("STDEV.S", stdev_s::call),
    ("STDEVA", stdeva::call),
    ("STDEVPA", stdevpa::call),
    ("STEYX", steyx::call),
    ("T.DIST", t_dist::call),
    ("T.DIST.2T", t_dist_2t::call),
    ("T.DIST.RT", t_dist_rt::call),
    ("T.INV", t_inv::call),
    ("T.INV.2T", t_inv_2t::call),
    ("T.TEST", t_test::call),
    ("TREND", trend::call),
    ("TRIMMEAN", trimmean::call),
    ("VAR.P", var_p::call),
    ("VAR.S", var_s::call),
    ("VARA", vara::call),
    ("VARPA", varpa::call),
    ("WEIBULL.DIST", weibull_dist::call),
    ("Z.TEST", z_test::call),
];
