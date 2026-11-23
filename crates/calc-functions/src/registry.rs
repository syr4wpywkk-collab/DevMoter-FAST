//! Standard function registry (v2 §3): aggregates every category's
//! `FUNCTIONS` list into one [`FunctionRegistry`] implementation.
//!
//! Parallel-PR convention: adding a function never touches this file —
//! create the file inside its category directory and add one line to
//! that category's `mod.rs` `FUNCTIONS` list. New *categories* get one
//! line in [`CATEGORIES`] below.

use calc_core::registry::{Function, FunctionRegistry};

use crate::{aggregate, array, datetime, functional, logical, lookup, math, statistics, text};

/// Aggregation point — exactly one entry per v2 §3 category, in the
/// plan's order. Empty categories contribute `&[]` so the structure is
/// complete before later PRs land functions.
const CATEGORIES: &[&[(&str, Function)]] = &[
    aggregate::FUNCTIONS,
    logical::FUNCTIONS,
    math::FUNCTIONS,
    lookup::FUNCTIONS,
    text::FUNCTIONS,
    datetime::FUNCTIONS,
    statistics::FUNCTIONS,
    array::FUNCTIONS,
    functional::FUNCTIONS,
];

/// Registry containing every implemented function. Lookup is a linear
/// scan over the (small, static) category lists; a `HashMap`/`phf`
/// index is a performance PR concern, not a correctness one.
#[derive(Debug, Clone, Copy, Default)]
pub struct StandardRegistry;

impl FunctionRegistry for StandardRegistry {
    fn lookup(&self, name: &str) -> Option<Function> {
        CATEGORIES
            .iter()
            .flat_map(|cat| cat.iter())
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, f)| *f)
    }
}

/// The default registry with all implemented functions — what
/// `calc-cli`, `calc-wasm` and tests install on the engine.
pub fn default_registry() -> StandardRegistry {
    StandardRegistry
}

/// Names of every registered function (Phase 1: the basic 13).
pub fn registered_names() -> impl Iterator<Item = &'static str> {
    CATEGORIES
        .iter()
        .flat_map(|cat| cat.iter())
        .map(|(n, _)| *n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_the_phase1_13() {
        // Every Phase-1 function is registered; later waves add more.
        let names: Vec<_> = registered_names().collect();
        for expected in [
            "ABS", "AND", "AVERAGE", "COUNT", "COUNTA", "IF", "IFERROR", "MAX", "MIN", "NOT", "OR",
            "ROUND", "SUM",
        ] {
            assert!(names.contains(&expected), "missing {expected}");
        }
    }

    #[test]
    fn lookup_is_case_insensitive() {
        let r = default_registry();
        assert!(r.lookup("sum").is_some());
        assert!(r.lookup("If").is_some());
        assert!(r.lookup("NOPE").is_none());
    }
}
