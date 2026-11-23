//! Random source (v2 §3): the shared draw primitives behind `RAND` and
//! `RANDBETWEEN`. The RNG itself is injected into [`EvalContext`] (like
//! `Clock`) so tests are deterministic and `calc-core` stays std-only;
//! this module only maps the `u64` stream onto the required ranges —
//! including the bias-free integer mapping (no `% n`).

use calc_core::eval::RngSource;

/// Uniform double in `[0, 1)`: top 53 bits scaled by 2^-53 (the standard
/// `nextDouble` mapping). `1.0` is unreachable.
pub fn unit_f64(rng: &dyn RngSource) -> f64 {
    (rng.next_u64() >> 11) as f64 * (1.0 / 9_007_199_254_740_992.0)
}

/// Uniform integer in `[lo, hi]` inclusive (requires `lo <= hi`), via
/// Lemire's multiply-shift rejection — no modulo bias. The full `i64`
/// span (`hi - lo + 1 == 2^64`) degenerates to a raw draw.
pub fn uniform_i64(rng: &dyn RngSource, lo: i64, hi: i64) -> i64 {
    debug_assert!(lo <= hi);
    let n = (hi as i128 - lo as i128 + 1) as u128;
    let draw = if n == (1u128 << 64) {
        rng.next_u64() as u128
    } else {
        let n = n as u64;
        // Reject draws whose low bits fall in the tail region that would
        // skew the mapping: 2^64 mod n values are over-represented.
        let threshold = n.wrapping_neg() % n;
        loop {
            let x = rng.next_u64();
            let m = (x as u128) * (n as u128);
            let low = m as u64;
            if low >= threshold {
                break m >> 64;
            }
        }
    };
    (lo as i128 + draw as i128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use calc_core::eval::SplitMix64;

    #[test]
    fn unit_interval() {
        let rng = SplitMix64::new(42);
        for _ in 0..10_000 {
            let x = unit_f64(&rng);
            assert!((0.0..1.0).contains(&x), "out of range: {x}");
        }
    }

    #[test]
    fn deterministic_sequence() {
        let a = SplitMix64::new(7);
        let b = SplitMix64::new(7);
        for _ in 0..100 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn different_seeds_differ() {
        let a = SplitMix64::new(1);
        let b = SplitMix64::new(2);
        assert_ne!(a.next_u64(), b.next_u64());
    }

    #[test]
    fn uniform_bounds() {
        let rng = SplitMix64::new(0);
        for _ in 0..10_000 {
            let x = uniform_i64(&rng, -5, 5);
            assert!((-5..=5).contains(&x));
        }
        assert_eq!(uniform_i64(&rng, 9, 9), 9);
    }

    #[test]
    fn uniform_degrees_cover_both_ends() {
        let rng = SplitMix64::new(123);
        let mut seen = std::collections::HashSet::new();
        for _ in 0..1_000 {
            seen.insert(uniform_i64(&rng, 0, 1));
        }
        assert!(seen.contains(&0) && seen.contains(&1));
    }
}
