//! Engineering functions (v3 tracks I11/I13): `engineering/*.rs`, one
//! file per function. Shared numerics live in
//! [`crate::common::numerics`] (Bessel kernels),
//! [`crate::common::number`] (base conversion and `BIT*` operand
//! helpers) and [`crate::common::complex`] (complex parse/format and
//! `IM*` arithmetic).

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
mod imexp;
mod imln;
mod imlog10;
mod imlog2;
mod impower;
mod improduct;
mod imreal;
mod imsec;
mod imsech;
mod imsin;
mod imsinh;
mod imsqrt;
mod imsub;
mod imsum;
mod imtan;
mod oct2bin;
mod oct2dec;
mod oct2hex;

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
    ("IMEXP", imexp::call),
    ("IMLN", imln::call),
    ("IMLOG10", imlog10::call),
    ("IMLOG2", imlog2::call),
    ("IMPOWER", impower::call),
    ("IMPRODUCT", improduct::call),
    ("IMREAL", imreal::call),
    ("IMSEC", imsec::call),
    ("IMSECH", imsech::call),
    ("IMSIN", imsin::call),
    ("IMSINH", imsinh::call),
    ("IMSQRT", imsqrt::call),
    ("IMSUB", imsub::call),
    ("IMSUM", imsum::call),
    ("IMTAN", imtan::call),
    ("OCT2BIN", oct2bin::call),
    ("OCT2DEC", oct2dec::call),
    ("OCT2HEX", oct2hex::call),
];
