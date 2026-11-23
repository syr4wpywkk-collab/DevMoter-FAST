//! text functions (v2 §1): `text/*.rs`, one file per function.

use calc_core::registry::Function;

mod concat;
mod find;
mod left;
mod len;
mod lower;
mod mid;
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
];
