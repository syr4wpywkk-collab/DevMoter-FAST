//! Comparison semantics (v2 §3) — **no code yet**.
//!
//! Intended role: the single ordering/equality relation for criteria,
//! `MATCH`/`XLOOKUP`/`LOOKUP` and `SORT` — Excel's type order
//! (number < text < boolean), case-insensitive text equality, and
//! blank-vs-zero handling, shared so functions never hand-roll
//! comparisons.
