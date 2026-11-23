//! Financial functions (v2 §1): `financial/*.rs`, one file per
//! function. Shared kernels live in [`crate::common::finance`]
//! (day counts, coupon schedules, annuities, bond pricing, rate
//! solvers).
//!
//! To add a function: create `financial/<name>.rs` with a `pub fn call`,
//! then add one `("<NAME>", <name>::call)` line to [`FUNCTIONS`].

use calc_core::registry::Function;

mod fv;
mod fvschedule;
mod intrate;
mod ipmt;
mod irr;
mod ispmt;
mod mduration;
mod mirr;
mod nominal;
mod nper;
mod npv;
mod oddfprice;
mod oddfyield;
mod oddlprice;
mod oddlyield;
mod pduration;
mod pmt;
mod ppmt;
mod price;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("FV", fv::call),
    ("FVSCHEDULE", fvschedule::call),
    ("INTRATE", intrate::call),
    ("IPMT", ipmt::call),
    ("IRR", irr::call),
    ("ISPMT", ispmt::call),
    ("MDURATION", mduration::call),
    ("MIRR", mirr::call),
    ("NOMINAL", nominal::call),
    ("NPER", nper::call),
    ("NPV", npv::call),
    ("ODDFPRICE", oddfprice::call),
    ("ODDFYIELD", oddfyield::call),
    ("ODDLPRICE", oddlprice::call),
    ("ODDLYIELD", oddlyield::call),
    ("PDURATION", pduration::call),
    ("PMT", pmt::call),
    ("PPMT", ppmt::call),
    ("PRICE", price::call),
];

/// Shared argument parsing for the bond functions: evaluate a scalar
/// date argument (truncated to a whole-day serial).
pub(crate) fn date_arg(
    ctx: &mut calc_core::eval::EvalContext<'_>,
    arg: &calc_core::ast::Expr,
) -> Result<Result<i64, calc_core::error::CalcError>, calc_core::eval::EvalError> {
    match crate::common::coercion::eval_number(ctx, arg)? {
        Err(e) => Ok(Err(e)),
        Ok(n) => Ok(Ok(crate::common::date_serial::trunc_to_i64(n))),
    }
}
