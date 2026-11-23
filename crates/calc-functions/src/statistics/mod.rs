//! Statistics functions (v2 §1): `statistics/*.rs`, one file per
//! function. Shared numeric kernels live in [`crate::common::statistics`].
//!
//! To add a function: create `statistics/<name>.rs` with a `pub fn call`,
//! then add one `("<NAME>", <name>::call)` line to [`FUNCTIONS`].

use calc_core::registry::Function;

mod avedev;
mod averagea;
mod averageif;
mod averageifs;
mod beta_dist;
mod beta_inv;
mod binom_dist;
mod binom_dist_range;
mod binom_inv;
mod chisq_dist;
mod chisq_dist_rt;
mod chisq_inv;
mod chisq_inv_rt;
mod chisq_test;
mod confidence_norm;
mod confidence_t;
mod correl;
mod countblank;
mod covariance_p;
mod covariance_s;
mod devsq;
mod expon_dist;
mod f_dist;
mod f_dist_rt;
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
    ("AVEDEV", avedev::call),
    ("AVERAGEA", averagea::call),
    ("AVERAGEIF", averageif::call),
    ("AVERAGEIFS", averageifs::call),
    ("BETA.DIST", beta_dist::call),
    ("BETA.INV", beta_inv::call),
    ("BINOM.DIST", binom_dist::call),
    ("BINOM.DIST.RANGE", binom_dist_range::call),
    ("BINOM.INV", binom_inv::call),
    ("CHISQ.DIST", chisq_dist::call),
    ("CHISQ.DIST.RT", chisq_dist_rt::call),
    ("CHISQ.INV", chisq_inv::call),
    ("CHISQ.INV.RT", chisq_inv_rt::call),
    ("CHISQ.TEST", chisq_test::call),
    ("CONFIDENCE.NORM", confidence_norm::call),
    ("CONFIDENCE.T", confidence_t::call),
    ("CORREL", correl::call),
    ("COUNTBLANK", countblank::call),
    ("COVARIANCE.P", covariance_p::call),
    ("COVARIANCE.S", covariance_s::call),
    ("DEVSQ", devsq::call),
    ("EXPON.DIST", expon_dist::call),
    ("F.DIST", f_dist::call),
    ("F.DIST.RT", f_dist_rt::call),
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
