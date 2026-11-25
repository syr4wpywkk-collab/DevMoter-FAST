//! datetime functions (v2 §1): `datetime/*.rs`, one file per function.
//!
//! All serial ↔ calendar conversion lives in
//! [`crate::common::date_serial`] (1900 leap-bug compatibility, 1904
//! offset, month-end clamping, time-of-day extraction); text↔serial
//! coercion for the v3 date functions lives in
//! [`crate::common::date_text`] (fixed date/time grammar, holiday
//! collection, `*.INTL` weekend masks). Day-count kernels
//! (`DAYS360`/`YEARFRAC`) are shared with the financial functions via
//! [`crate::common::finance`].

use calc_core::registry::Function;

mod date;
mod datedif;
mod datevalue;
mod day;
mod days;
mod days360;
mod edate;
mod eomonth;
mod hour;
mod isoweeknum;
mod minute;
mod month;
mod networkdays;
mod networkdays_intl;
mod now;
mod second;
mod time;
mod timevalue;
mod today;
mod weekday;
mod weeknum;
mod workday;
mod workday_intl;
mod year;
mod yearfrac;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("DATE", date::call),
    ("DATEDIF", datedif::call),
    ("DATEVALUE", datevalue::call),
    ("DAY", day::call),
    ("DAYS", days::call),
    ("DAYS360", days360::call),
    ("EDATE", edate::call),
    ("EOMONTH", eomonth::call),
    ("HOUR", hour::call),
    ("ISOWEEKNUM", isoweeknum::call),
    ("MINUTE", minute::call),
    ("MONTH", month::call),
    ("NETWORKDAYS", networkdays::call),
    ("NETWORKDAYS.INTL", networkdays_intl::call),
    ("NOW", now::call),
    ("SECOND", second::call),
    ("TIME", time::call),
    ("TIMEVALUE", timevalue::call),
    ("TODAY", today::call),
    ("WEEKDAY", weekday::call),
    ("WEEKNUM", weeknum::call),
    ("WORKDAY", workday::call),
    ("WORKDAY.INTL", workday_intl::call),
    ("YEAR", year::call),
    ("YEARFRAC", yearfrac::call),
];
