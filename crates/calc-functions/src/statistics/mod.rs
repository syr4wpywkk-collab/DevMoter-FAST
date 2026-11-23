//! Statistics functions (v2 §1): `statistics/*.rs`, one file per
//! function. Shared numeric kernels live in [`crate::common::statistics`].
//!
//! To add a function: create `statistics/<name>.rs` with a `pub fn call`,
//! then add one `("<NAME>", <name>::call)` line to [`FUNCTIONS`].

use calc_core::registry::Function;

mod correl;
mod intercept;
mod large;
mod linest;
mod logest;
mod lognorm_dist;
mod lognorm_inv;
mod maxa;
mod maxifs;
mod median;
mod mina;
mod minifs;
mod mode_mult;
mod mode_sngl;
mod negbinom_dist;
mod norm_dist;
mod norm_inv;
mod norm_s_dist;
mod norm_s_inv;
mod pearson;
mod percentile_exc;
mod percentile_inc;
mod percentrank_exc;
mod percentrank_inc;
mod permut;
mod permutationa;
mod phi;
mod poisson_dist;
mod prob;
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
    ("LINEST", linest::call),
    ("LOGEST", logest::call),
    ("LOGNORM.DIST", lognorm_dist::call),
    ("LOGNORM.INV", lognorm_inv::call),
    ("MAXA", maxa::call),
    ("MAXIFS", maxifs::call),
    ("MEDIAN", median::call),
    ("MINA", mina::call),
    ("MINIFS", minifs::call),
    ("MODE.MULT", mode_mult::call),
    ("MODE.SNGL", mode_sngl::call),
    ("NEGBINOM.DIST", negbinom_dist::call),
    ("NORM.DIST", norm_dist::call),
    ("NORM.INV", norm_inv::call),
    ("NORM.S.DIST", norm_s_dist::call),
    ("NORM.S.INV", norm_s_inv::call),
    ("PEARSON", pearson::call),
    ("PERCENTILE.EXC", percentile_exc::call),
    ("PERCENTILE.INC", percentile_inc::call),
    ("PERCENTRANK.EXC", percentrank_exc::call),
    ("PERCENTRANK.INC", percentrank_inc::call),
    ("PERMUT", permut::call),
    ("PERMUTATIONA", permutationa::call),
    ("PHI", phi::call),
    ("POISSON.DIST", poisson_dist::call),
    ("PROB", prob::call),
    ("QUARTILE.INC", quartile_inc::call),
    ("RANK.EQ", rank_eq::call),
    ("SLOPE", slope::call),
    ("SMALL", small::call),
    ("STDEV.S", stdev_s::call),
    ("VAR.S", var_s::call),
];
