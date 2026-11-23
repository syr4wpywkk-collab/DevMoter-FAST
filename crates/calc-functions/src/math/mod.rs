//! Math functions (v2 §1): `math/*.rs`, one file per function.

use calc_core::registry::Function;

mod abs;
mod acos;
mod acosh;
mod acot;
mod acoth;
mod aggregate;
mod arabic;
mod asin;
mod asinh;
mod atan;
mod atan2;
mod atanh;
mod base;
mod ceiling;
mod ceiling_math;
mod ceiling_precise;
mod combin;
mod combina;
mod cos;
mod cosh;
mod cot;
mod coth;
mod csc;
mod exp;
mod floor_math;
mod int;
mod log;
mod mod_fn;
mod power;
mod rand;
mod randbetween;
mod round;
mod sqrt;
mod trunc;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("ABS", abs::call),
    ("ACOS", acos::call),
    ("ACOSH", acosh::call),
    ("ACOT", acot::call),
    ("ACOTH", acoth::call),
    ("AGGREGATE", aggregate::call),
    ("ARABIC", arabic::call),
    ("ASIN", asin::call),
    ("ASINH", asinh::call),
    ("ATAN", atan::call),
    ("ATAN2", atan2::call),
    ("ATANH", atanh::call),
    ("BASE", base::call),
    ("CEILING", ceiling::call),
    ("CEILING.MATH", ceiling_math::call),
    ("CEILING.PRECISE", ceiling_precise::call),
    ("COMBIN", combin::call),
    ("COMBINA", combina::call),
    ("COS", cos::call),
    ("COSH", cosh::call),
    ("COT", cot::call),
    ("COTH", coth::call),
    ("CSC", csc::call),
    ("EXP", exp::call),
    ("FLOOR.MATH", floor_math::call),
    ("INT", int::call),
    ("LOG", log::call),
    ("MOD", mod_fn::call),
    ("POWER", power::call),
    ("RAND", rand::call),
    ("RANDBETWEEN", randbetween::call),
    ("ROUND", round::call),
    ("SQRT", sqrt::call),
    ("TRUNC", trunc::call),
];
