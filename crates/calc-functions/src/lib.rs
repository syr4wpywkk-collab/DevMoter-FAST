//! calc-functions: the standard worksheet-function library for
//! `calc-core` (v2 plan §3).
//!
//! Layout mirrors `docs/FUNCTION_PLAN_V2.md` §1: one file per function
//! inside its category directory (`aggregate/`, `logical/`, `math/`,
//! `lookup/`, `text/`, `datetime/`, `statistics/`, `array/`,
//! `functional/`); shared semantics live in [`common`]; [`registry`]
//! aggregates every category's `FUNCTIONS` list into the
//! [`StandardRegistry`] installed on `CalcEngine`.
//!
//! Dependency direction: this crate depends on `calc-core` (for
//! [`calc_core::registry::FunctionRegistry`] and the `Function`
//! signature); `calc-core` never depends on this crate.

pub mod aggregate;
pub mod array;
pub mod common;
pub mod datetime;
pub mod financial;
pub mod functional;
pub mod logical;
pub mod lookup;
pub mod math;
pub mod registry;
pub mod statistics;
pub mod text;

pub use registry::{StandardRegistry, default_registry, registered_names};
