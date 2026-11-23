//! Date serial conversion (v2 §3): the single owner of `f64` serial ↔
//! calendar date conversion, honoring the workbook's
//! [`calc_core::workbook::DateSystem`].
//!
//! 1900 system (Excel/Windows default): serial 1 = 1900-01-01 and the
//! fictitious serial 60 = 1900-02-29 is preserved for file
//! compatibility — the serial line is linear *including* that slot, so
//! serial arithmetic just works (`serial 60 + 1` = 61 = 1900-03-01).
//! Serial 0 maps to the "1900-01-00" quirk (day 0). Serials below 0 or
//! above [`MAX_SERIAL_1900`] are outside the domain.
//!
//! 1904 system (old Mac default): serial 0 = 1904-01-01, proleptic
//! Gregorian, no fictitious day.
//!
//! Also owns the shared policies the datetime functions need:
//! `DATE`-style overflow normalization ([`normalized_serial`]),
//! month-end clamping for `EDATE`/`EOMONTH` ([`days_in_month`]), and
//! the boundary-tolerant time-of-day split used by
//! `HOUR`/`MINUTE`/`SECOND` ([`time_components`]).
//!
//! SPEC-OPEN points (documented in `docs/SPEC-OPEN.md` and `specOpen`
//! fixture cases): timezone policy for `TODAY`/`NOW` (currently UTC),
//! the 1904-system `DATE` year-offset rule, and exact serial bounds at
//! the fictitious/quirk edges.

use calc_core::workbook::DateSystem;

/// Largest valid serial in the 1900 system: 9999-12-31.
pub const MAX_SERIAL_1900: i64 = 2_958_465;

/// Days from the civil epoch (1970-01-01) to `(year, month, day)` in
/// the proleptic Gregorian calendar. Howard Hinnant's algorithm.
const fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = ((m as i64) + 9) % 12; // Mar=0 .. Feb=11
    let doy = (153 * mp + 2) / 5 + (d as i64) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719_468
}

/// Inverse of [`days_from_civil`].
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// `days_from_civil` of the day that is serial 0 in each system.
const EPOCH_DAYS_1900: i64 = days_from_civil(1899, 12, 31); // -25568
const EPOCH_DAYS_1904: i64 = days_from_civil(1904, 1, 1); // -24107

/// Serial of 1970-01-01 in each system (for the injected [`Clock`]).
const UNIX_EPOCH_SERIAL_1900: i64 = 25_569;
const UNIX_EPOCH_SERIAL_1904: i64 = 24_107;

/// Largest valid serial under `system` (9999-12-31 in both).
pub fn max_serial(system: DateSystem) -> i64 {
    match system {
        DateSystem::Excel1900 => MAX_SERIAL_1900,
        DateSystem::Excel1904 => days_from_civil(9999, 12, 31) - EPOCH_DAYS_1904,
    }
}

/// Leap-year test in the *workbook* calendar. Under the 1900 system
/// year 1900 counts as a leap year (bug compatibility), matching how
/// Excel treats serials 59–61.
pub fn is_leap_year(year: i64, system: DateSystem) -> bool {
    if system == DateSystem::Excel1900 && year == 1900 {
        return true;
    }
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

/// Days in `(year, month)` under `system`'s calendar. `month` must be
/// 1..=12; under the 1900 system February 1900 has 29 days.
pub fn days_in_month(year: i64, month: u32, system: DateSystem) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year, system) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Serial of the first of `(year, month)` without domain validation —
/// linear, so it may be negative or exceed the max.
fn first_of_month_serial(year: i64, month: u32, system: DateSystem) -> i64 {
    let c = days_from_civil(year, month, 1);
    match system {
        // Shift all real days at/after the fictitious 1900-02-29 slot.
        DateSystem::Excel1900 => {
            let s = c - EPOCH_DAYS_1900;
            if s >= 60 { s + 1 } else { s }
        }
        DateSystem::Excel1904 => c - EPOCH_DAYS_1904,
    }
}

/// Serial for `(year, month, day)` where `day` may be outside
/// `1..=days_in_month` (linear day offset from the first of the month).
/// Returns `None` when the result falls outside the serial domain.
pub fn date_to_serial(year: i64, month: u32, day: i64, system: DateSystem) -> Option<i64> {
    let s = first_of_month_serial(year, month, system).checked_add(day - 1)?;
    (s >= 0 && s <= max_serial(system)).then_some(s)
}

/// Serial for possibly-overflowing `DATE`-style arguments: `month` rolls
/// over years (`month` 0 → December of the prior year, 13 → January of
/// the next), then `day` offsets linearly from the normalized first of
/// month (`day` 0 → last day of the prior month). Saturates to `None`
/// on out-of-domain results.
pub fn normalized_serial(year: i64, month: i64, day: i64, system: DateSystem) -> Option<i64> {
    let total = year.checked_mul(12)?.checked_add(month - 1)?;
    let ny = total.div_euclid(12);
    let nm = total.rem_euclid(12) as u32 + 1;
    date_to_serial(ny, nm, day, system)
}

/// Calendar `(year, month, day)` of a serial. `day` is 0 only for the
/// 1900-system serial-0 quirk ("1900-01-00"); `(1900, 2, 29)` is the
/// fictitious bug-compat day for serial 60. Returns `None` for serials
/// outside `0..=max_serial`.
pub fn serial_to_date(serial: i64, system: DateSystem) -> Option<(i64, u32, u32)> {
    if serial < 0 || serial > max_serial(system) {
        return None;
    }
    match system {
        DateSystem::Excel1900 => Some(match serial {
            0 => (1900, 1, 0),
            60 => (1900, 2, 29),
            s if s < 60 => civil_from_days(EPOCH_DAYS_1900 + s),
            s => civil_from_days(EPOCH_DAYS_1900 + s - 1),
        }),
        DateSystem::Excel1904 => Some(civil_from_days(EPOCH_DAYS_1904 + serial)),
    }
}

/// Integer serial (date part) and day fraction of a Unix timestamp
/// (seconds since 1970-01-01 UTC). Used by `TODAY`/`NOW` against the
/// injected clock. Returns `None` when the date is outside the serial
/// domain.
///
/// SPEC-OPEN: the session timezone is UTC; a workbook/session timezone
/// setting may shift the calendar date later.
pub fn unix_to_serial(unix_seconds: i64, system: DateSystem) -> Option<(i64, f64)> {
    let days = unix_seconds.div_euclid(86_400);
    let secs = unix_seconds.rem_euclid(86_400);
    let epoch = match system {
        DateSystem::Excel1900 => UNIX_EPOCH_SERIAL_1900,
        DateSystem::Excel1904 => UNIX_EPOCH_SERIAL_1904,
    };
    let serial = days.checked_add(epoch)?;
    if !(0..=max_serial(system)).contains(&serial) {
        return None;
    }
    Some((serial, secs as f64 / 86_400.0))
}

/// `(hour, minute, second)` of a serial's fractional part, shared by
/// `HOUR`/`MINUTE`/`SECOND`. The day fraction is rounded to the nearest
/// whole second first so binary error at exact boundaries
/// (`TIME(12,0,0)`-style results) cannot spill into the wrong unit; a
/// fraction rounding up to 24:00 wraps to 0:00.
///
/// SPEC-OPEN: whether Excel rounds or truncates sub-second fractions;
/// rounding chosen for boundary tolerance.
///
/// Returns `None` for negative or out-of-domain serials.
pub fn time_components(serial: f64) -> Option<(u32, u32, u32)> {
    if !serial.is_finite() || serial < 0.0 {
        return None;
    }
    let frac = serial - serial.floor();
    let secs = (frac * 86_400.0).round() as i64 % 86_400;
    Some((
        (secs / 3600) as u32,
        (secs / 60 % 60) as u32,
        (secs % 60) as u32,
    ))
}

/// Whole-second truncation toward zero, used for `months`-style and
/// component arguments (`f64` → `i64`, saturating on overflow).
pub fn trunc_to_i64(v: f64) -> i64 {
    if v.is_finite() {
        v.trunc().clamp(i64::MIN as f64, i64::MAX as f64) as i64
    } else {
        i64::MAX
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use calc_core::workbook::DateSystem::{Excel1900, Excel1904};

    #[test]
    fn serial_one_is_1900_01_01() {
        assert_eq!(serial_to_date(1, Excel1900), Some((1900, 1, 1)));
        assert_eq!(date_to_serial(1900, 1, 1, Excel1900), Some(1));
    }

    #[test]
    fn fictitious_feb_29_is_serial_60() {
        assert_eq!(serial_to_date(60, Excel1900), Some((1900, 2, 29)));
        assert_eq!(serial_to_date(59, Excel1900), Some((1900, 2, 28)));
        assert_eq!(serial_to_date(61, Excel1900), Some((1900, 3, 1)));
        // Linear day offsets land on the fictitious slot.
        assert_eq!(date_to_serial(1900, 2, 29, Excel1900), Some(60));
        assert_eq!(date_to_serial(1900, 2, 30, Excel1900), Some(61));
        assert_eq!(date_to_serial(1900, 3, 1, Excel1900), Some(61));
    }

    #[test]
    fn serial_zero_quirk() {
        assert_eq!(serial_to_date(0, Excel1900), Some((1900, 1, 0)));
        assert_eq!(date_to_serial(1900, 1, 0, Excel1900), Some(0));
        assert_eq!(serial_to_date(-1, Excel1900), None);
    }

    #[test]
    fn modern_dates_match_excel() {
        // 1970-01-01 is serial 25569; 2023-01-01 is 44927.
        assert_eq!(date_to_serial(1970, 1, 1, Excel1900), Some(25_569));
        assert_eq!(date_to_serial(2023, 1, 1, Excel1900), Some(44_927));
        assert_eq!(serial_to_date(44_927, Excel1900), Some((2023, 1, 1)));
        assert_eq!(
            date_to_serial(9999, 12, 31, Excel1900),
            Some(MAX_SERIAL_1900)
        );
        assert_eq!(date_to_serial(10000, 1, 1, Excel1900), None);
    }

    #[test]
    fn system_1904_has_no_bug_day() {
        assert_eq!(serial_to_date(0, Excel1904), Some((1904, 1, 1)));
        assert_eq!(serial_to_date(1, Excel1904), Some((1904, 1, 2)));
        assert_eq!(serial_to_date(-1, Excel1904), None);
        // Same calendar date is 1462 lower than in the 1900 system.
        assert_eq!(
            date_to_serial(2026, 1, 1, Excel1900).unwrap()
                - date_to_serial(2026, 1, 1, Excel1904).unwrap(),
            1462
        );
        assert_eq!(date_to_serial(1904, 2, 29, Excel1904), Some(59));
    }

    #[test]
    fn normalized_serial_rolls_over() {
        assert_eq!(
            normalized_serial(2024, 13, 1, Excel1900),
            date_to_serial(2025, 1, 1, Excel1900)
        );
        assert_eq!(
            normalized_serial(2024, 0, 1, Excel1900),
            date_to_serial(2023, 12, 1, Excel1900)
        );
        assert_eq!(
            normalized_serial(2024, 1, 32, Excel1900),
            date_to_serial(2024, 2, 1, Excel1900)
        );
        assert_eq!(
            normalized_serial(2024, 1, 0, Excel1900),
            date_to_serial(2023, 12, 31, Excel1900)
        );
        assert_eq!(
            normalized_serial(2024, -1, 1, Excel1900),
            date_to_serial(2023, 11, 1, Excel1900)
        );
        // Non-leap Feb 29 normalizes to Mar 1.
        assert_eq!(
            normalized_serial(2023, 2, 29, Excel1900),
            date_to_serial(2023, 3, 1, Excel1900)
        );
        assert_eq!(
            normalized_serial(2024, 12_000, 1, Excel1900),
            date_to_serial(3023, 12, 1, Excel1900)
        );
        assert_eq!(normalized_serial(2024, -12_000_000, 1, Excel1900), None);
    }

    #[test]
    fn unix_epoch_and_fraction() {
        assert_eq!(unix_to_serial(0, Excel1900), Some((25_569, 0.0)));
        let (d, f) = unix_to_serial(43_200, Excel1900).unwrap();
        assert_eq!(d, 25_569);
        assert!((f - 0.5).abs() < 1e-12);
        assert_eq!(unix_to_serial(0, Excel1904), Some((24_107, 0.0)));
    }

    #[test]
    fn time_components_boundary_tolerance() {
        assert_eq!(time_components(0.0), Some((0, 0, 0)));
        assert_eq!(time_components(0.5), Some((12, 0, 0)));
        assert_eq!(time_components(45_000.75), Some((18, 0, 0)));
        // 15:45:30 as a day fraction.
        let t = (15.0 * 3600.0 + 45.0 * 60.0 + 30.0) / 86_400.0;
        assert_eq!(time_components(t), Some((15, 45, 30)));
        assert_eq!(time_components(-0.5), None);
    }

    #[test]
    fn days_in_month_bug_compat() {
        assert_eq!(days_in_month(1900, 2, Excel1900), 29);
        assert_eq!(days_in_month(1900, 2, Excel1904), 28);
        assert_eq!(days_in_month(2024, 2, Excel1900), 29);
        assert_eq!(days_in_month(2023, 2, Excel1900), 28);
        assert_eq!(days_in_month(2026, 1, Excel1900), 31);
    }
}
