//! Number primitives (v2 §3) — **no code yet**.
//!
//! Intended role: shared numeric operations for the math category —
//! round-half-away-from-zero, `INT`/`TRUNC`/`MOD` semantics,
//! significance/mode rules for `CEILING.MATH`/`FLOOR.MATH`, and the
//! `#NUM!` boundary checks, so each `math/*.rs` file stays a thin spec
//! wrapper.

use calc_core::error::CalcError;
use calc_core::value::Value;
/// Excel `MOD` semantics: `n - d * floor(n / d)`; the result takes the
/// sign of `d`, never raw `%` (v2 §2, `docs/functions/MOD.md`).
/// `-0` is normalized to `+0`.
pub fn fmod_excel(number: f64, divisor: f64) -> f64 {
    let r = number - divisor * (number / divisor).floor();
    if r == 0.0 { 0.0 } else { r }
}

/// Round `x` to a multiple of positive `significance`.
/// `up = true` rounds toward +inf (ceiling), `false` toward -inf (floor).
///
/// A near-exact quotient (`x / sig` within a relative epsilon of an
/// integer) is treated as an exact multiple so binary float noise does
/// not push an already-aligned value one step over
/// (`CEILING.MATH(0.3, 0.1)` -> `0.3`, not `0.4`).
pub fn round_to_significance(x: f64, significance: f64, up: bool) -> f64 {
    if significance == 0.0 {
        // Excel returns 0 for significance 0 (SPEC-OPEN: negative input).
        return 0.0;
    }
    let q = x / significance;
    let nearest = q.round();
    if (q - nearest).abs() <= nearest.abs().max(1.0) * 1e-12 {
        // Already (within float noise) an exact multiple: return `x`
        // itself so `CEILING.MATH(0.3, 0.1)` is `0.3`, not
        // `0.30000000000000004` (`3 * 0.1`).
        return x;
    }
    let snapped = if up { q.ceil() } else { q.floor() };
    snapped * significance
}

/// Excel-style rounding to a decimal *place* for `ROUNDDOWN`/`ROUNDUP`
/// (`docs/functions/ROUNDDOWN.md`, `ROUNDUP.md`).
///
/// Shares `ROUND`'s basis: the 15-significant-digit decimal
/// representation of `x` is truncated (`up = false`, toward zero) or
/// incremented (`up = true`, away from zero — only when a nonzero digit
/// is discarded). `num_digits` is truncated toward zero and clamped like
/// `ROUND`; a non-finite `x` or `num_digits` yields `NaN` so callers map
/// to `#NUM!`. A result that overflows f64 (huge negative `num_digits`
/// under `up`) returns infinity — likewise `#NUM!`.
pub fn round_to_place(x: f64, num_digits: f64, up: bool) -> f64 {
    if !x.is_finite() || !num_digits.is_finite() {
        return f64::NAN;
    }
    if x == 0.0 {
        return 0.0;
    }
    let digits = num_digits.trunc().clamp(-320.0, 320.0) as i32;

    // Decimal view: |x| = 0.d[0]d[1]…d[14] × 10^exp10, 15 sig digits.
    let s = format!("{:.14e}", x.abs());
    let (mantissa, exp) = s.split_once('e').unwrap();
    let exp10: i32 = exp.parse::<i32>().unwrap() + 1;
    let mut d: Vec<u8> = mantissa.bytes().filter(|b| b.is_ascii_digit()).collect();
    debug_assert_eq!(d.len(), 15);

    // Digits d[k] sit at decimal place exp10-1-k; rounding at place
    // -digits keeps `keep = exp10 + digits` significant digits.
    let keep = exp10 + digits;
    if keep <= 0 {
        if !up {
            return 0.0;
        }
        // Away from zero: smallest magnitude representable at that
        // place, 10^-digits (may overflow to infinity -> #NUM!).
        let v: f64 = format!("1e{}", -digits).parse().unwrap_or(f64::INFINITY);
        return v.copysign(x);
    }
    if keep as usize >= d.len() {
        return x;
    }
    let keep = keep as usize;
    let mut len = keep;
    let mut out_exp = exp10;
    if up && d[keep..].iter().any(|&b| b != b'0') {
        // Away from zero: increment the kept digits with carry.
        let mut i = keep;
        loop {
            if i == 0 {
                d.insert(0, b'1');
                len += 1;
                out_exp += 1;
                break;
            }
            i -= 1;
            if d[i] == b'9' {
                d[i] = b'0';
            } else {
                d[i] += 1;
                break;
            }
        }
    }
    let mant = d[..len]
        .iter()
        .fold(0u64, |m, b| m * 10 + (b - b'0') as u64);
    let v: f64 = format!("{mant}e{}", out_exp - len as i32)
        .parse()
        .unwrap_or(0.0);
    v.copysign(x)
}

/// `2^48` — the exclusive upper bound of every `BIT*` operand
/// (`docs/functions/BITAND.md`).
pub const BIT_OPERAND_MAX: f64 = 281_474_976_710_656.0;

/// The `number` argument of the string-digit base-conversion family
/// (`BIN2DEC`/`BIN2HEX`/`BIN2OCT`, and the `OCT2*`/`HEX2*` siblings):
/// accepts a text digit string, or a `Value::Number` whose *decimal
/// rendering* is re-read as digits in `radix` (`BIN2DEC(101)` = `5`).
///
/// Validation: at least one character, at most `max_chars`, every
/// character a digit of `radix` (letters accepted both cases for
/// `radix > 10`). Any violation -> `Err(CalcError::Num)` — the family
/// uses `#NUM!` for invalid input, not `#VALUE!`. `Blank` yields
/// `"0"`; booleans/arrays are rejected (`#NUM!`, SPEC-OPEN for
/// booleans); a `Value::Error` propagates unchanged.
pub fn base_digits(v: &Value, radix: u32, max_chars: usize) -> Result<String, CalcError> {
    let digits = match v {
        Value::Text(s) => s.clone(),
        Value::Number(n) => {
            if n.is_nan() || *n != n.trunc() || *n < 0.0 || *n >= 1e15 {
                return Err(CalcError::Num);
            }
            format!("{n:.0}")
        }
        Value::Blank => "0".to_string(),
        Value::Error(e) => return Err(*e),
        _ => return Err(CalcError::Num),
    };
    if digits.is_empty() || digits.len() > max_chars || !digits.chars().all(|c| c.is_digit(radix)) {
        return Err(CalcError::Num);
    }
    Ok(digits)
}

/// `BIT*` operand coercion: the value must truncate to a non-negative
/// integer `< 2^48`. Fractional inputs are truncated toward zero —
/// the family is documented to truncate (SPEC-OPEN: some Microsoft
/// docs instead describe `#NUM!` for non-integers). Returns `None`
/// for out-of-domain input; the caller maps that to `#NUM!`.
pub fn bit_operand(v: f64) -> Option<u64> {
    if v.is_nan() {
        return None;
    }
    let t = v.trunc();
    if t < 0.0 || t >= BIT_OPERAND_MAX {
        None
    } else {
        Some(t as u64)
    }
}

/// Render integer `n` in `radix` the way the `DEC2?` functions do:
/// uppercase digits; a negative `n` produces the 10-character
/// two's-complement form in that radix (`-1` -> `"FFFFFFFFFF"` hex,
/// `"7777777777"` octal, `"1111111111"` binary) with `places` ignored.
/// The caller must have range-checked `n` so `radix^10 + n >= 0`.
///
/// `places` is the already-truncated optional width: `< 0` or `> 10`
/// -> `Err(CalcError::Num)`; smaller than the digit count of a
/// positive result -> `Err(CalcError::Num)`; otherwise the result is
/// zero-padded to `places`.
pub fn format_radix(n: i64, radix: u32, places: Option<i64>) -> Result<String, CalcError> {
    if let Some(p) = places {
        if !(0..=10).contains(&p) {
            return Err(CalcError::Num);
        }
        if n >= 0 {
            let s = to_radix(n, radix);
            if s.len() as i64 > p {
                return Err(CalcError::Num);
            }
            return Ok(format!("{s:0>w$}", w = p as usize));
        }
    }
    if n < 0 {
        let modulus = (radix as i64).pow(10);
        return Ok(to_radix(modulus + n, radix));
    }
    Ok(to_radix(n, radix))
}

/// `shift_amount` for `BITLSHIFT`/`BITRSHIFT`: truncated toward zero,
/// clamped so the `i64`/`u32` casts in the callers are always safe
/// (any magnitude beyond 64 already pins the result).
pub fn shift_amount(v: f64) -> i64 {
    if v.is_nan() {
        return 0;
    }
    v.trunc().clamp(-1e15, 1e15) as i64
}

/// Uppercase positional rendering of a non-negative integer.
fn to_radix(n: i64, radix: u32) -> String {
    if n == 0 {
        return "0".to_string();
    }
    let mut v = n as u64;
    let mut buf = Vec::new();
    while v > 0 {
        let d = (v % radix as u64) as u32;
        buf.push(char::from_digit(d, radix).unwrap().to_ascii_uppercase());
        v /= radix as u64;
    }
    buf.iter().rev().collect()
}

/// Fixed-point text formatting shared by `FIXED` and `DOLLAR`
/// (`docs/functions/FIXED.md`, `DOLLAR.md`): en-US fixed-locale
/// output — `,` grouping, `.` decimal point, no currency symbol.
///
/// `places` is already truncated by the caller; negative values round
/// left of the decimal point and the clamp `[-30, 30]` stands in for
/// Excel's loosely-documented range limit (SPEC-OPEN in both spec
/// docs). Rounding is half away from zero on the 15-significant-digit
/// decimal representation — the same basis as `TEXT`'s `round_places`
/// and `ROUND`.
pub fn format_fixed(n: f64, places: i32, commas: bool) -> String {
    let places = places.clamp(-30, 30);
    if !n.is_finite() {
        return format!("{n}");
    }
    let neg = n.is_sign_negative();
    let v = n.abs();

    // 15 significant decimal digits: |v| = 0.d[0]d[1]… × 10^exp10.
    let (mut d, mut exp10) = if v == 0.0 {
        (vec![b'0'], 0)
    } else {
        let s = format!("{v:.14e}");
        let (mant, exp) = s.split_once('e').unwrap();
        (
            mant.bytes().filter(|b| b.is_ascii_digit()).collect(),
            exp.parse::<i32>().unwrap() + 1,
        )
    };

    // Round half away from zero at `keep = exp10 + places` digits.
    let keep = exp10 + places;
    if keep <= 0 {
        // Everything is discarded: rounds to zero unless the first
        // significant digit is >= 5 and the rounding place is exactly
        // the leading position (e.g. FIXED(99.5, -2) -> "100").
        if keep == 0 && d[0] >= b'5' {
            d = vec![b'1'];
            exp10 += 1;
        } else {
            d.clear();
            exp10 = 1;
        }
    } else {
        if (keep as usize) < d.len() && d[keep as usize] >= b'5' {
            let mut i = keep as usize;
            loop {
                if i == 0 {
                    d = vec![b'1'];
                    d.resize(keep as usize, b'0');
                    exp10 += 1;
                    break;
                }
                i -= 1;
                if d[i] == b'9' {
                    d[i] = b'0';
                } else {
                    d[i] += 1;
                    break;
                }
            }
        }
        d.resize(keep as usize, b'0');
        d.truncate(keep as usize);
    }

    // Digit d[k] sits at decimal position exp10-1-k. Positions with no
    // stored digit are '0' (truncated-away or beyond precision).
    let int_len = exp10.max(0) as usize;
    let mut int = String::with_capacity(int_len + int_len / 3);
    for k in 0..int_len {
        int.push(d.get(k).copied().unwrap_or(b'0') as char);
    }
    if int.is_empty() {
        int.push('0');
    }
    if commas {
        int = group_thousands(&int);
    }

    let mut out = String::new();
    if neg {
        out.push('-');
    }
    out.push_str(&int);
    if places > 0 {
        out.push('.');
        // Fraction position p in -1..=-places maps to digit index
        // k = exp10-1-p; indices below 0 are leading zeros.
        for j in 0..places {
            let k = exp10 + j;
            out.push(if k >= 0 {
                d.get(k as usize).copied().unwrap_or(b'0') as char
            } else {
                '0'
            });
        }
    }
    out
}

/// Insert `,` thousands separators into an integer digit string.
fn group_thousands(s: &str) -> String {
    let n = s.len();
    let mut out = String::with_capacity(n + n / 3);
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (n - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}
