//! Date serial conversion (v2 §3): the only place that converts between
//! `f64` date serials and calendar dates, honoring the workbook's
//! [`calc_core::workbook::DateSystem`] (1900 default, 1904 field already
//! exists). Owns the 1900 leap-year-bug compatibility decision,
//! month-end clamping for `EDATE`/`EOMONTH`, and time-fraction handling
//! for `HOUR`/`MINUTE`/`SECOND`.

use calc_core::workbook::DateSystem;

/// Days from the civil epoch (1970-01-01) to `y-m-d`, proleptic
/// Gregorian. Howard Hinnant's `days_from_civil`.
fn days_from_civil(y: i32, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = (m as i64 + 9) % 12; // Mar=0 .. Feb=11
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `y-m-d` for `z` days after the civil epoch (1970-01-01).
/// Howard Hinnant's `civil_from_days`.
fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    ((if m <= 2 { y + 1 } else { y }) as i32, m, d)
}

/// Whole-day part of a date serial, truncated toward zero.
pub fn whole_days(serial: f64) -> f64 {
    serial.trunc()
}

/// Convert the integer part of a date serial to `(year, month, day)`.
///
/// - `Excel1900`: serial 1 = 1900-01-01; serial 60 is the fictitious
///   1900-02-29 and is returned verbatim (the caller formats it like
///   Excel does, even though the date never existed); serial 0 is the
///   Excel "January 0" quirk, returned as `(1900, 1, 0)`.
/// - `Excel1904`: serial 0 = 1904-01-01.
///
/// Returns `None` for negative or non-finite serials, which callers map
/// to `#NUM!`.
pub fn serial_to_ymd(serial: f64, system: DateSystem) -> Option<(i32, u32, u32)> {
    if !serial.is_finite() || serial < 0.0 || serial >= 3_000_000.0 {
        return None;
    }
    let s = serial.trunc() as i64;
    match system {
        DateSystem::Excel1904 => {
            let epoch = days_from_civil(1904, 1, 1);
            Some(civil_from_days(epoch + s))
        }
        DateSystem::Excel1900 => {
            if s == 0 {
                // Excel displays serial 0 as 0-Jan-1900.
                return Some((1900, 1, 0));
            }
            if s == 60 {
                return Some((1900, 2, 29));
            }
            let epoch = days_from_civil(1899, 12, 31);
            let days = if s > 60 { s - 1 } else { s };
            Some(civil_from_days(epoch + days))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serial_one_is_1900_01_01() {
        assert_eq!(
            serial_to_ymd(1.0, DateSystem::Excel1900),
            Some((1900, 1, 1))
        );
    }

    #[test]
    fn serial_60_is_fictitious_feb29() {
        assert_eq!(
            serial_to_ymd(60.0, DateSystem::Excel1900),
            Some((1900, 2, 29))
        );
    }

    #[test]
    fn serial_61_is_march_1() {
        assert_eq!(
            serial_to_ymd(61.0, DateSystem::Excel1900),
            Some((1900, 3, 1))
        );
    }

    #[test]
    fn modern_date() {
        // 2026-11-23 is serial 46349 in the 1900 system.
        assert_eq!(
            serial_to_ymd(46349.0, DateSystem::Excel1900),
            Some((2026, 11, 23))
        );
    }

    #[test]
    fn system_1904() {
        assert_eq!(
            serial_to_ymd(0.0, DateSystem::Excel1904),
            Some((1904, 1, 1))
        );
        assert_eq!(
            serial_to_ymd(1.0, DateSystem::Excel1904),
            Some((1904, 1, 2))
        );
    }

    #[test]
    fn fraction_and_negative() {
        assert_eq!(
            serial_to_ymd(61.9, DateSystem::Excel1900),
            Some((1900, 3, 1))
        );
        assert_eq!(serial_to_ymd(-1.0, DateSystem::Excel1900), None);
    }
}
