//! Information functions (v3 track i18): `information/*.rs`, one file
//! per function. `TYPE` uses `type_fn.rs` (`type` is a keyword, same
//! convention as `logical/if_fn.rs`).
//!
//! `STOCKHISTORY` is registered as a documented `#N/A` stub: its spec
//! (`docs/functions/STOCKHISTORY.md`) marks it NOT IMPLEMENTABLE
//! OFFLINE — registering the name keeps dependent formulas parseable.

use calc_core::registry::Function;

mod cell;
mod error_type;
mod info;
mod isblank;
mod iserr;
mod iserror;
mod iseven;
mod isformula;
mod islogical;
mod isna;
mod isnontext;
mod isodd;
mod isomitted;
mod isref;
mod n;
mod na;
mod sheet;
mod sheets;
mod stockhistory;
mod type_fn;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("CELL", cell::call),
    ("ERROR.TYPE", error_type::call),
    ("INFO", info::call),
    ("ISBLANK", isblank::call),
    ("ISERR", iserr::call),
    ("ISERROR", iserror::call),
    ("ISEVEN", iseven::call),
    ("ISFORMULA", isformula::call),
    ("ISLOGICAL", islogical::call),
    ("ISNA", isna::call),
    ("ISNONTEXT", isnontext::call),
    ("ISODD", isodd::call),
    ("ISOMITTED", isomitted::call),
    ("ISREF", isref::call),
    ("N", n::call),
    ("NA", na::call),
    ("SHEET", sheet::call),
    ("SHEETS", sheets::call),
    ("STOCKHISTORY", stockhistory::call),
    ("TYPE", type_fn::call),
];
