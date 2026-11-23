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
