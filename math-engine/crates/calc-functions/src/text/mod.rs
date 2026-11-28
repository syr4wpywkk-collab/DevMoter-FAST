//! text functions (v2 §1): `text/*.rs`, one file per function.

use calc_core::registry::Function;

/// Uppercase one character, keeping it when Unicode maps it to several
/// (`ß` stays `ß`), so text length never changes — as Excel does.
pub(crate) fn upper_char(c: char) -> char {
    let mut mapped = c.to_uppercase();
    match (mapped.next(), mapped.next()) {
        (Some(u), None) => u,
        _ => c,
    }
}

/// Lowercase one character, keeping it when Unicode maps it to several
/// (`İ` would become `i` plus a combining dot).
pub(crate) fn lower_char(c: char) -> char {
    let mut mapped = c.to_lowercase();
    match (mapped.next(), mapped.next()) {
        (Some(l), None) => l,
        _ => c,
    }
}

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
mod regexextract;
mod regexreplace;
mod regextest;
mod replace;
mod replaceb;
mod rept;
mod right;
mod rightb;
mod search;
mod searchb;
mod substitute;
mod t;
// File name fixed by v2 §1 (`text/text.rs` implements TEXT).
#[allow(clippy::module_inception)]
mod text;
mod textafter;
mod textbefore;
mod textjoin;
mod textsplit;
mod trim;
mod unichar;
mod unicode;
mod upper;
mod value;
mod valuetotext;

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
    ("REPT", rept::call),
    ("T", t::call),
    ("UNICHAR", unichar::call),
    ("UNICODE", unicode::call),
    ("VALUETOTEXT", valuetotext::call),
    ("TEXTBEFORE", textbefore::call),
    ("TEXTAFTER", textafter::call),
    ("TEXTSPLIT", textsplit::call),
    ("RIGHTB", rightb::call),
    ("REPLACEB", replaceb::call),
    ("SEARCHB", searchb::call),
    ("REGEXTEST", regextest::call),
    ("REGEXEXTRACT", regexextract::call),
    ("REGEXREPLACE", regexreplace::call),
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
