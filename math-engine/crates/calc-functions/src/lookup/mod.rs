//! Lookup functions (v2 §1): `lookup/*.rs`, one file per function.
//! Shared match/search semantics live in [`crate::common::lookup`].

use calc_core::registry::Function;

mod address;
mod areas;
mod choose;
mod choosecols;
mod chooserows;
mod column;
mod columns;
mod expand;
mod formulatext;
mod groupby_fn;
mod hlookup;
mod hyperlink;
mod index;
mod indirect;
mod lookup_fn;
mod match_fn;
mod offset;
mod pivotby;
mod row;
mod rows;
mod sortby;
mod trimrange;
mod vlookup;
mod wrapcols;
mod wraprows;
mod xlookup;
mod xmatch;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
///
/// File-name deviations from `docs/FUNCTION_PLAN_V2.md` §1 (same
/// convention as `logical/if_fn.rs`): `match` is a Rust keyword, and a
/// `lookup` module inside `lookup/` trips `clippy::module_inception`,
/// so the files are `match_fn.rs` and `lookup_fn.rs`; `groupby_fn.rs`
/// avoids colliding with `crate::common::groupby` in import lists.
///
/// Track-i19 skips (see the track PR): `GETPIVOTDATA` (no pivot model),
/// `IMAGE` and `RTD` (both NOT IMPLEMENTABLE OFFLINE per their specs).
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("ADDRESS", address::call),
    ("AREAS", areas::call),
    ("CHOOSE", choose::call),
    ("CHOOSECOLS", choosecols::call),
    ("CHOOSEROWS", chooserows::call),
    ("COLUMN", column::call),
    ("COLUMNS", columns::call),
    ("EXPAND", expand::call),
    ("FORMULATEXT", formulatext::call),
    ("GROUPBY", groupby_fn::call),
    ("HLOOKUP", hlookup::call),
    ("HYPERLINK", hyperlink::call),
    ("INDEX", index::call),
    ("INDIRECT", indirect::call),
    ("LOOKUP", lookup_fn::call),
    ("MATCH", match_fn::call),
    ("OFFSET", offset::call),
    ("PIVOTBY", pivotby::call),
    ("ROW", row::call),
    ("ROWS", rows::call),
    ("SORTBY", sortby::call),
    ("TRIMRANGE", trimrange::call),
    ("VLOOKUP", vlookup::call),
    ("WRAPCOLS", wrapcols::call),
    ("WRAPROWS", wraprows::call),
    ("XLOOKUP", xlookup::call),
    ("XMATCH", xmatch::call),
];
