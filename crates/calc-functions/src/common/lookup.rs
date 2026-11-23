//! Lookup matching (v2 §3) — **no code yet**.
//!
//! Intended role: exact-match and approximate-match scanning shared by
//! `MATCH`/`XLOOKUP`/`VLOOKUP`/`HLOOKUP`/`LOOKUP` — sorted-input
//! assumptions, `#N/A` production, and wildcard support, delegated to
//! [`crate::common::compare`] for value ordering.
