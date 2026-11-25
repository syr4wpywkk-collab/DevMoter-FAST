//! array functions (v2 §1): `array/*.rs`, one file per function.

use calc_core::registry::Function;

mod drop;
mod filter;
mod hstack;
mod sequence;
mod sort;
mod take;
mod tocol;
mod torow;
mod transpose;
mod unique;
mod vstack;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("DROP", drop::call),
    ("FILTER", filter::call),
    ("HSTACK", hstack::call),
    ("SEQUENCE", sequence::call),
    ("SORT", sort::call),
    ("TAKE", take::call),
    ("TOCOL", tocol::call),
    ("TOROW", torow::call),
    ("TRANSPOSE", transpose::call),
    ("UNIQUE", unique::call),
    ("VSTACK", vstack::call),
];
