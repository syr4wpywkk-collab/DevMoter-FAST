//! Engineering functions (v3 track I11): `engineering/*.rs`, one file
//! per function. Shared numerics live in [`crate::common::numerics`]
//! (Bessel kernels), [`crate::common::number`] (base conversion and
//! `BIT*` operand helpers) and [`crate::common::complex`] (`COMPLEX`
//! output format).

use calc_core::registry::Function;

mod besseli;
mod besselj;
mod besselk;
mod bessely;
mod bin2dec;
mod bin2hex;
mod bin2oct;
mod bitand;
mod bitlshift;
mod bitor;
mod bitrshift;
mod bitxor;
mod complex_fn;
mod convert;
mod dec2bin;
mod dec2hex;
mod dec2oct;
mod delta;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("BESSELI", besseli::call),
    ("BESSELJ", besselj::call),
    ("BESSELK", besselk::call),
    ("BESSELY", bessely::call),
    ("BIN2DEC", bin2dec::call),
    ("BIN2HEX", bin2hex::call),
    ("BIN2OCT", bin2oct::call),
    ("BITAND", bitand::call),
    ("BITLSHIFT", bitlshift::call),
    ("BITOR", bitor::call),
    ("BITRSHIFT", bitrshift::call),
    ("BITXOR", bitxor::call),
    ("COMPLEX", complex_fn::call),
    ("CONVERT", convert::call),
    ("DEC2BIN", dec2bin::call),
    ("DEC2HEX", dec2hex::call),
    ("DEC2OCT", dec2oct::call),
    ("DELTA", delta::call),
];
