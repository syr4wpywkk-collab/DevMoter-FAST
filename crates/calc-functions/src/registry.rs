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

    fn is_volatile(&self, name: &str) -> bool {
        VOLATILE_NAMES.iter().any(|v| v.eq_ignore_ascii_case(name))
    }
}

/// Function names whose cells re-evaluate on every `recalculate()`
/// pass (v2 §5.1 volatile functions). `TODAY`/`NOW` were already
/// volatile-via-clock; the flag now covers `RAND`/`RANDBETWEEN` too.
/// `INDIRECT`/`OFFSET` are volatile because their target reference is
/// only known at evaluation time — the dependency graph cannot track
/// it statically (ADR 0002); listed ahead of their implementations so
/// formulas containing them are already conservative.
pub const VOLATILE_NAMES: &[&str] = &["RAND", "RANDBETWEEN", "TODAY", "NOW", "INDIRECT", "OFFSET"];

/// The default registry with all implemented functions — what
/// `calc-cli`, `calc-wasm` and tests install on the engine.
pub fn default_registry() -> StandardRegistry {
    StandardRegistry
}

/// Names of every registered function.
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
    fn registers_all_implemented_functions() {
        let mut names: Vec<_> = registered_names().collect();
        names.sort_unstable();
        assert_eq!(
            names,
            [
                "ABS",
                "AND",
                "AVERAGE",
                "CEILING.MATH",
                "CHOOSE",
                "COLUMN",
                "COLUMNS",
                "CONCAT",
                "CORREL",
                "COUNT",
                "COUNTA",
                "COUNTIF",
                "COUNTIFS",
                "DATE",
                "DAY",
                "DROP",
                "EDATE",
                "EOMONTH",
                "EXP",
                "FILTER",
                "FIND",
                "FLOOR.MATH",
                "HLOOKUP",
                "HOUR",
                "HSTACK",
                "IF",
                "IFERROR",
                "IFS",
                "INDEX",
                "INT",
                "INTERCEPT",
                "ISNUMBER",
                "ISTEXT",
                "LAMBDA",
                "LARGE",
                "LEFT",
                "LEN",
                "LET",
                "LOG",
                "LOOKUP",
                "LOWER",
                "MAP",
                "MATCH",
                "MAX",
                "MEDIAN",
                "MID",
                "MIN",
                "MINUTE",
                "MOD",
                "MODE.SNGL",
                "MONTH",
                "NOT",
                "NOW",
                "OR",
                "PERCENTILE.INC",
                "POWER",
                "PRODUCT",
                "PROPER",
                "QUARTILE.EXC",
                "QUARTILE.INC",
                "RAND",
                "RANDBETWEEN",
                "RANK.AVG",
                "RANK.EQ",
                "REDUCE",
                "REPLACE",
                "RIGHT",
                "ROUND",
                "ROW",
                "ROWS",
                "RSQ",
                "SEARCH",
                "SECOND",
                "SEQUENCE",
                "SKEW",
                "SKEW.P",
                "SLOPE",
                "SMALL",
                "SORT",
                "SQRT",
                "STANDARDIZE",
                "STDEV.P",
                "STDEV.S",
                "STDEVA",
                "STDEVPA",
                "STEYX",
                "SUBSTITUTE",
                "SUM",
                "SUMIF",
                "SUMIFS",
                "SUMPRODUCT",
                "SWITCH",
                "T.DIST",
                "T.DIST.2T",
                "T.DIST.RT",
                "T.INV",
                "T.INV.2T",
                "T.TEST",
                "TAKE",
                "TEXT",
                "TEXTJOIN",
                "TIME",
                "TOCOL",
                "TODAY",
                "TOROW",
                "TRANSPOSE",
                "TREND",
                "TRIM",
                "TRIMMEAN",
                "TRUNC",
                "UNIQUE",
                "UPPER",
                "VALUE",
                "VAR.P",
                "VAR.S",
                "VARA",
                "VARPA",
                "VLOOKUP",
                "VSTACK",
                "WEIBULL.DIST",
                "XLOOKUP",
                "YEAR",
                "Z.TEST",
            ]
        );
    }

    #[test]
    fn lookup_is_case_insensitive() {
        let r = default_registry();
        assert!(r.lookup("sum").is_some());
        assert!(r.lookup("If").is_some());
        assert!(r.lookup("NOPE").is_none());
    }
}
