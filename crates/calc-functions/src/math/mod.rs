//! Math functions (v2 §1): `math/*.rs`, one file per function.

use calc_core::registry::Function;

mod abs;
mod ceiling_math;
mod exp;
mod floor_math;
mod int;
mod log;
mod mod_fn;
mod power;
mod round;
mod sqrt;
mod trunc;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("ABS", abs::call),
    ("CEILING.MATH", ceiling_math::call),
    ("EXP", exp::call),
    ("FLOOR.MATH", floor_math::call),
    ("INT", int::call),
    ("LOG", log::call),
    ("MOD", mod_fn::call),
    ("POWER", power::call),
    ("ROUND", round::call),
    ("SQRT", sqrt::call),
    ("TRUNC", trunc::call),
];
