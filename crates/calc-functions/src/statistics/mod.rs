//! Statistics functions (v2 §1): `statistics/*.rs`, one file per
//! function. Shared numeric kernels live in [`crate::common::statistics`].
//!
//! To add a function: create `statistics/<name>.rs` with a `pub fn call`,
//! then add one `("<NAME>", <name>::call)` line to [`FUNCTIONS`].

use calc_core::registry::Function;

mod correl;
mod f_inv;
mod f_inv_rt;
mod f_test;
mod fisher;
mod fisherinv;
mod forecast;
mod forecast_ets;
mod forecast_ets_confint;
mod forecast_ets_seasonality;
mod forecast_ets_stat;
mod forecast_linear;
mod frequency;
mod gamma;
mod gamma_dist;
mod gamma_inv;
mod gammaln;
mod gammaln_precise;
mod gauss;
mod geomean;
mod growth;
mod harmean;
mod hypgeom_dist;
mod intercept;
mod kurt;
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
    ("F.INV", f_inv::call),
    ("F.INV.RT", f_inv_rt::call),
    ("F.TEST", f_test::call),
    ("FISHER", fisher::call),
    ("FISHERINV", fisherinv::call),
    ("FORECAST", forecast::call),
    ("FORECAST.ETS", forecast_ets::call),
    ("FORECAST.ETS.CONFINT", forecast_ets_confint::call),
    ("FORECAST.ETS.SEASONALITY", forecast_ets_seasonality::call),
    ("FORECAST.ETS.STAT", forecast_ets_stat::call),
    ("FORECAST.LINEAR", forecast_linear::call),
    ("FREQUENCY", frequency::call),
    ("GAMMA", gamma::call),
    ("GAMMA.DIST", gamma_dist::call),
    ("GAMMA.INV", gamma_inv::call),
    ("GAMMALN", gammaln::call),
    ("GAMMALN.PRECISE", gammaln_precise::call),
    ("GAUSS", gauss::call),
    ("GEOMEAN", geomean::call),
    ("GROWTH", growth::call),
    ("HARMEAN", harmean::call),
    ("HYPGEOM.DIST", hypgeom_dist::call),
    ("INTERCEPT", intercept::call),
    ("KURT", kurt::call),
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
