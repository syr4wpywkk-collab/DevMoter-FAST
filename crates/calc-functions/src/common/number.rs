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
