//! Math functions (v2 §1): `math/*.rs`, one file per function.

use calc_core::registry::Function;

mod abs;
mod round;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[("ABS", abs::call), ("ROUND", round::call)];
