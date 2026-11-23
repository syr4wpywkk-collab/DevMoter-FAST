//! Excel 2003-era compatibility functions (v3 §1): the legacy names
//! retained in modern Excel's "compatibility" category
//! (`compatibility/*.rs`, one file per function). Each is a thin
//! wrapper over the shared kernels in [`crate::common::numerics`] /
//! [`crate::common::statistics`], matching the modern dotted
//! equivalents where the spec docs declare them identical.
//!
//! To add a function: create `compatibility/<name>.rs` with a `pub fn
//! call`, then add one `("<NAME>", <name>::call)` line to [`FUNCTIONS`].

use calc_core::registry::Function;

mod negbinomdist;
mod normdist;
mod norminv;
mod normsdist;
mod normsinv;
mod percentile;
mod percentrank;
mod poisson;
mod quartile;
mod rank;
mod stdev;
mod stdevp;
mod tdist;
mod tinv;
mod ttest;
mod var;
mod varp;
mod weibull;
mod ztest;

/// `(name, fn)` pairs in plan order.
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("NEGBINOMDIST", negbinomdist::call),
    ("NORMDIST", normdist::call),
    ("NORMINV", norminv::call),
    ("NORMSDIST", normsdist::call),
    ("NORMSINV", normsinv::call),
    ("PERCENTILE", percentile::call),
    ("PERCENTRANK", percentrank::call),
    ("POISSON", poisson::call),
    ("QUARTILE", quartile::call),
    ("RANK", rank::call),
    ("STDEV", stdev::call),
    ("STDEVP", stdevp::call),
    ("TDIST", tdist::call),
    ("TINV", tinv::call),
    ("TTEST", ttest::call),
    ("VAR", var::call),
    ("VARP", varp::call),
    ("WEIBULL", weibull::call),
    ("ZTEST", ztest::call),
];
