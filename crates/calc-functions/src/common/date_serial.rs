//! Date serial conversion (v2 §3) — **no code yet**.
//!
//! Intended role: the only place that converts between `f64` date
//! serials and calendar dates, honoring the workbook's
//! [`calc_core::workbook::DateSystem`] (1900 default, 1904 field already
//! exists). Owns the 1900 leap-year-bug compatibility decision,
//! month-end clamping for `EDATE`/`EOMONTH`, and time-fraction handling
//! for `HOUR`/`MINUTE`/`SECOND`.
