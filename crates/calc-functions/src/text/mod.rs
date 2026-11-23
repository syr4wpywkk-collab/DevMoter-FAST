//! text functions (v2 §1): `text/*.rs`, one file per function.

use calc_core::registry::Function;

mod arraytotext;
mod asc;
mod bahttext;
mod char;
mod clean;
mod code;
mod concat;
mod concatenate;
mod dbcs;
mod dollar;
mod exact;
mod find;
mod findb;
mod fixed;
mod left;
mod leftb;
mod len;
mod lenb;
mod lower;
mod mid;
mod midb;
mod numbervalue;
mod proper;
mod replace;
mod right;
mod search;
mod substitute;
// File name fixed by v2 §1 (`text/text.rs` implements TEXT).
#[allow(clippy::module_inception)]
mod text;
mod textjoin;
mod trim;
mod upper;
mod value;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("LEFT", left::call),
    ("RIGHT", right::call),
    ("MID", mid::call),
    ("LEN", len::call),
    ("TRIM", trim::call),
    ("CONCAT", concat::call),
    ("CONCATENATE", concatenate::call),
    ("UPPER", upper::call),
    ("LOWER", lower::call),
    ("PROPER", proper::call),
    ("FIND", find::call),
    ("SEARCH", search::call),
    ("SUBSTITUTE", substitute::call),
    ("REPLACE", replace::call),
    ("TEXTJOIN", textjoin::call),
    ("TEXT", text::call),
    ("VALUE", value::call),
    ("ARRAYTOTEXT", arraytotext::call),
    ("ASC", asc::call),
    ("BAHTTEXT", bahttext::call),
    ("CHAR", char::call),
    ("CLEAN", clean::call),
    ("CODE", code::call),
    ("DBCS", dbcs::call),
    ("DOLLAR", dollar::call),
    ("EXACT", exact::call),
    ("FINDB", findb::call),
    ("FIXED", fixed::call),
    ("LEFTB", leftb::call),
    ("LENB", lenb::call),
    ("MIDB", midb::call),
    ("NUMBERVALUE", numbervalue::call),
];
