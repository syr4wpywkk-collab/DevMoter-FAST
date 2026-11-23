//! Math functions (v2 §1): `math/*.rs`, one file per function.

use calc_core::registry::Function;

mod abs;
mod ceiling_math;
mod exp;
mod floor_math;
mod int;
mod log;
mod mod_fn;
mod pi;
mod power;
mod quotient;
mod radians;
mod rand;
mod randarray;
mod randbetween;
mod roman;
mod round;
mod rounddown;
mod roundup;
mod sec;
mod sech;
mod seriessum;
mod sign;
mod sin;
mod sinh;
mod sqrt;
mod sqrtpi;
mod subtotal;
mod sumsq;
mod sumx2my2;
mod sumx2py2;
mod sumxmy2;
mod tan;
mod tanh;
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
    ("PI", pi::call),
    ("POWER", power::call),
    ("QUOTIENT", quotient::call),
    ("RADIANS", radians::call),
    ("RAND", rand::call),
    ("RANDARRAY", randarray::call),
    ("RANDBETWEEN", randbetween::call),
    ("ROMAN", roman::call),
    ("ROUND", round::call),
    ("ROUNDDOWN", rounddown::call),
    ("ROUNDUP", roundup::call),
    ("SEC", sec::call),
    ("SECH", sech::call),
    ("SERIESSUM", seriessum::call),
    ("SIGN", sign::call),
    ("SIN", sin::call),
    ("SINH", sinh::call),
    ("SQRT", sqrt::call),
    ("SQRTPI", sqrtpi::call),
    ("SUBTOTAL", subtotal::call),
    ("SUMSQ", sumsq::call),
    ("SUMX2MY2", sumx2my2::call),
    ("SUMX2PY2", sumx2py2::call),
    ("SUMXMY2", sumxmy2::call),
    ("TAN", tan::call),
    ("TANH", tanh::call),
    ("TRUNC", trunc::call),
];
