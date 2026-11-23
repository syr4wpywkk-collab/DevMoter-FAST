//! Criteria matching (v2 §3) — **no code yet**.
//!
//! Intended role: parse and apply the condition expressions used by
//! `SUMIF`/`SUMIFS`/`COUNTIF`/`COUNTIFS`/`SUMPRODUCT`-style functions
//! (`">5"`, `"<>x"`, wildcards `*`/`?`/`~`). Owner of criteria syntax,
//! case rules and error mapping so the conditional-aggregation PR
//! implements them once.
