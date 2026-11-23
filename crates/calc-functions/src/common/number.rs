//! Number primitives (v2 §3) — **no code yet**.
//!
//! Intended role: shared numeric operations for the math category —
//! round-half-away-from-zero, `INT`/`TRUNC`/`MOD` semantics,
//! significance/mode rules for `CEILING.MATH`/`FLOOR.MATH`, and the
//! `#NUM!` boundary checks, so each `math/*.rs` file stays a thin spec
//! wrapper.

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

// ---------- Engineering helpers (v3, track I11) ----------

use calc_core::error::CalcError;
use calc_core::value::Value;

/// `2^48` — the exclusive upper bound of every `BIT*` operand
/// (`docs/functions/BITAND.md`).
pub const BIT_OPERAND_MAX: f64 = 281_474_976_710_656.0;

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

/// `shift_amount` for `BITLSHIFT`/`BITRSHIFT`: truncated toward zero,
/// clamped so the `i64`/`u32` casts in the callers are always safe
/// (any magnitude beyond 64 already pins the result).
pub fn shift_amount(v: f64) -> i64 {
    if v.is_nan() {
        return 0;
    }
    v.trunc().clamp(-1e15, 1e15) as i64
}

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
