//! Random source (v2 §3) — **no code yet**.
//!
//! Intended role: the injectable, seedable PRNG behind `RAND` and
//! `RANDBETWEEN`. Like [`calc_core::eval::Clock`], the source is injected
//! so tests are deterministic and the engine stays std-only; volatile
//! recalculation is wired in a later PR.
