//! datetime functions (v2 §1): `datetime/*.rs`, one file per function.
//!
//! All serial ↔ calendar conversion lives in
//! [`crate::common::date_serial`] (1900 leap-bug compatibility, 1904
//! offset, month-end clamping, time-of-day extraction); the function
//! files here only own argument coercion and error mapping.

use calc_core::registry::Function;

mod date;
mod day;
mod edate;
mod eomonth;
mod hour;
mod minute;
mod month;
mod now;
mod second;
mod time;
mod today;
mod year;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("DATE", date::call),
    ("DAY", day::call),
    ("EDATE", edate::call),
    ("EOMONTH", eomonth::call),
    ("HOUR", hour::call),
    ("MINUTE", minute::call),
    ("MONTH", month::call),
    ("NOW", now::call),
    ("SECOND", second::call),
    ("TIME", time::call),
    ("TODAY", today::call),
    ("YEAR", year::call),
];
