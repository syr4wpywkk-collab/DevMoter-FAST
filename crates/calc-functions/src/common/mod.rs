//! Shared semantics layer (v2 §3): argument coercion, criteria matching,
//! comparison ordering, number formatting, date serials, text indexing,
//! lookup matching, statistics kernels and the injectable random source.
//!
//! Every module here is the single owner of its concern; function files
//! must not re-implement these rules locally.

pub mod coercion;

// Declared per v2 §3. Modules with no code yet carry a doc comment
// stating their intended role — no stub implementations.
pub mod compare;
pub mod criteria;
pub mod date_serial;
pub mod lookup;
pub mod number;
pub mod random;
pub mod statistics;
pub mod text_index;
