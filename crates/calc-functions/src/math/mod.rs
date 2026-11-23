//! Math functions (v2 §1): `math/*.rs`, one file per function.

use calc_core::registry::Function;

mod abs;
mod ceiling_math;
mod csch;
mod decimal;
mod degrees;
mod even;
mod exp;
mod fact;
mod factdouble;
mod floor;
mod floor_math;
mod floor_precise;
mod gcd;
mod int;
mod iso_ceiling;
mod lcm;
mod ln;
mod log;
mod log10;
mod matrix;
mod mdeterm;
mod minverse;
mod mmult;
mod mod_fn;
mod mround;
mod multinomial;
mod munit;
mod odd;
mod percentof;
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
    ("CEILING.MATH", ceiling_math::call),
    ("CSCH", csch::call),
    ("DECIMAL", decimal::call),
    ("DEGREES", degrees::call),
    ("EVEN", even::call),
    ("EXP", exp::call),
    ("FACT", fact::call),
    ("FACTDOUBLE", factdouble::call),
    ("FLOOR", floor::call),
    ("FLOOR.MATH", floor_math::call),
    ("FLOOR.PRECISE", floor_precise::call),
    ("GCD", gcd::call),
    ("INT", int::call),
    ("ISO.CEILING", iso_ceiling::call),
    ("LCM", lcm::call),
    ("LN", ln::call),
    ("LOG", log::call),
    ("LOG10", log10::call),
    ("MDETERM", mdeterm::call),
    ("MINVERSE", minverse::call),
    ("MMULT", mmult::call),
    ("MOD", mod_fn::call),
    ("MROUND", mround::call),
    ("MULTINOMIAL", multinomial::call),
    ("MUNIT", munit::call),
    ("ODD", odd::call),
    ("PERCENTOF", percentof::call),
    ("POWER", power::call),
    ("RAND", rand::call),
    ("RANDBETWEEN", randbetween::call),
    ("ROUND", round::call),
    ("SQRT", sqrt::call),
    ("TRUNC", trunc::call),
];
