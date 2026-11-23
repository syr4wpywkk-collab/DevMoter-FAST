//! Engineering functions (v3 tracks I11+I12): `engineering/*.rs`, one
//! file per function. Shared numerics live in [`crate::common::numerics`]
//! (Bessel kernels, `erf`/`erfc`), [`crate::common::number`] (base
//! conversion and `BIT*` operand helpers) and [`crate::common::complex`]
//! (`COMPLEX` output format and `IM*` arithmetic).

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
mod erf;
mod erf_precise;
mod erfc;
mod erfc_precise;
mod gestep;
mod hex2bin;
mod hex2dec;
mod hex2oct;
mod imabs;
mod imaginary;
mod imargument;
mod imconjugate;
mod imcos;
mod imcosh;
mod imcot;
mod imcsc;
mod imcsch;
mod imdiv;

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
    ("ERF", erf::call),
    ("ERF.PRECISE", erf_precise::call),
    ("ERFC", erfc::call),
    ("ERFC.PRECISE", erfc_precise::call),
    ("GESTEP", gestep::call),
    ("HEX2BIN", hex2bin::call),
    ("HEX2DEC", hex2dec::call),
    ("HEX2OCT", hex2oct::call),
    ("IMABS", imabs::call),
    ("IMAGINARY", imaginary::call),
    ("IMARGUMENT", imargument::call),
    ("IMCONJUGATE", imconjugate::call),
    ("IMCOS", imcos::call),
    ("IMCOSH", imcosh::call),
    ("IMCOT", imcot::call),
    ("IMCSC", imcsc::call),
    ("IMCSCH", imcsch::call),
    ("IMDIV", imdiv::call),
];
