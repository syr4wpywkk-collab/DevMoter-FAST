//! Functional functions (v2 §1): `functional/*.rs`, one file per
//! function.
//!
//! `LET` and `LAMBDA` are evaluator special forms (lazy/scope-aware) like
//! `IF`; `MAP` and `REDUCE` invoke `Value::Lambda` through
//! [`calc_core::eval::EvalContext::call_lambda`]. The LET file is
//! `let_fn.rs` (`let` is a Rust keyword).

use calc_core::registry::Function;

mod lambda;
mod let_fn;
mod map;
mod reduce;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("LAMBDA", lambda::call),
    ("LET", let_fn::call),
    ("MAP", map::call),
    ("REDUCE", reduce::call),
];
