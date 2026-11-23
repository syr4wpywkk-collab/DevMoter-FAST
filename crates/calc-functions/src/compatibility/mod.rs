//! Compatibility functions (v3): pre-2010 Excel legacy names kept for
//! workbook compatibility — `compatibility/*.rs`, one file per
//! function. Each delegates to the same [`crate::common::numerics`]
//! kernels as its modern `*.*` equivalent in
//! [`crate::statistics`].
//!
//! To add a function: create `compatibility/<name>.rs` with a
//! `pub fn call`, then add one `("<NAME>", <name>::call)` line to
//! [`FUNCTIONS`].

use calc_core::registry::Function;

mod betadist;
mod betainv;
mod binomdist;
mod chidist;
mod chiinv;
mod chitest;
mod confidence;
mod covar;
mod critbinom;
mod expondist;
mod fdist;
mod finv;
mod ftest;
mod gammadist;
mod gammainv;
mod hypgeomdist;
mod loginv;
mod lognormdist;
mod mode;
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

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("BETADIST", betadist::call),
    ("BETAINV", betainv::call),
    ("BINOMDIST", binomdist::call),
    ("CHIDIST", chidist::call),
    ("CHIINV", chiinv::call),
    ("CHITEST", chitest::call),
    ("CONFIDENCE", confidence::call),
    ("COVAR", covar::call),
    ("CRITBINOM", critbinom::call),
    ("EXPONDIST", expondist::call),
    ("FDIST", fdist::call),
    ("FINV", finv::call),
    ("FTEST", ftest::call),
    ("GAMMADIST", gammadist::call),
    ("GAMMAINV", gammainv::call),
    ("HYPGEOMDIST", hypgeomdist::call),
    ("LOGINV", loginv::call),
    ("LOGNORMDIST", lognormdist::call),
    ("MODE", mode::call),
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
