//! Financial conventions (v3 foundation): the shared primitives the
//! bond/loan function family (`PRICE`, `YIELD`, `ACCRINT`, `COUP*`,
//! `DURATION`, `ODDF*`, `TBILL*`, `YEARFRAC`, `PMT`, `IRR`, `XIRR`)
//! is built from.
//!
//! Owns:
//! - Day-count bases `0..=4` ([`DayCountBasis`]): US 30/360,
//!   actual/actual, actual/360, actual/365, European 30/360 —
//!   `days_between` and `year_fraction` including the 30/360
//!   end-of-month adjustments described in `docs/functions/YEARFRAC.md`.
//! - Coupon-schedule generation anchored at `maturity`, stepping by
//!   `12/frequency` months with sticky end-of-month clinging:
//!   [`coupon_schedule`], [`coupon_period_days`].
//! - Cash-flow math: [`npv`], [`xnpv`], and [`solve_rate`], a
//!   Newton-accelerated bisection solver with bracket expansion for
//!   `IRR`/`YIELD`/`RATE`-style inversions.
//! - Annuity closed forms [`annuity_pv`], [`annuity_fv`],
//!   [`annuity_pmt`] including `type` (0/1) and the `rate == 0` limits.
//!
//! All dates are integer serials in the workbook's
//! [`calc_core::workbook::DateSystem`]; conversion lives in
//! [`crate::common::date_serial`]. Fractional serials are the callers'
//! concern (function files truncate, matching the COUP* family).
//!
//! SPEC-OPEN (tracked in `docs/SPEC-OPEN.md`):
//! - `year_fraction` basis-1 denominator when the interval spans
//!   multiple years: implemented as "366 if a Feb 29 falls inside the
//!   interval (inclusive of endpoints' leap-year membership), else
//!   365; same-year intervals use that year's length". Excel does not
//!   do an ISDA split-year sum, but the exact multi-year rule is
//!   unconfirmed.
//! - Robust solvers may converge where Excel's fixed-iteration Newton
//!   diverges (e.g. `IRR({-70000,12000,15000})` has a root at r≈-0.44
//!   that Excel reports as `#NUM!`); function tracks decide how to map
//!   solver results onto Excel's convergence domain.
//! - EOM anchoring: implemented as sticky-EOM (maturity on month end ⇒
//!   all coupon dates on month end), otherwise day-of-month clipped to
//!   the target month's length. Needs reference confirmation for
//!   maturity day 29–31.

use crate::common::date_serial;
use calc_core::workbook::DateSystem;

/// Day-count basis code used across the financial functions.
/// `0` US (NASD) 30/360, `1` actual/actual, `2` actual/360,
/// `3` actual/365, `4` European 30/360.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DayCountBasis {
    Us30_360,
    ActAct,
    Act360,
    Act365,
    Eur30_360,
}

impl DayCountBasis {
    /// Parse a basis code (`0..=4`); `None` maps to `#NUM!` by callers.
    pub fn from_code(code: i64) -> Option<Self> {
        Some(match code {
            0 => Self::Us30_360,
            1 => Self::ActAct,
            2 => Self::Act360,
            3 => Self::Act365,
            4 => Self::Eur30_360,
            _ => return None,
        })
    }
}

/// Whether `(year, month, day)` is the last day of its month.
fn is_month_end(y: i64, m: u32, d: u32, system: DateSystem) -> bool {
    d == date_serial::days_in_month(y, m, system)
}

/// Whether `(year, month, day)` is the last day of February.
fn is_feb_end(y: i64, m: u32, d: u32, system: DateSystem) -> bool {
    m == 2 && is_month_end(y, m, d, system)
}

/// Days between two `(year, month, day)` dates under US (NASD) 30/360:
/// `360*(y2-y1) + 30*(m2-m1) + (d2-d1)` after the NASD adjustments —
/// a start on Feb's last day counts as day 30, a 31st becomes 30 (the
/// end 31st only when the start is already 30, otherwise it rolls to
/// the 1st of the next month).
pub fn days360_us(start: (i64, u32, u32), end: (i64, u32, u32), system: DateSystem) -> i64 {
    let (y1, m1, mut d1) = start;
    let (y2, mut m2, mut d2) = end;
    if is_feb_end(y1, m1, d1, system) {
        d1 = 30;
        if is_feb_end(y2, m2, d2, system) {
            d2 = 30;
        }
    }
    if d1 == 31 {
        d1 = 30;
    }
    if d2 == 31 {
        if d1 == 30 {
            d2 = 30;
        } else {
            d2 = 1;
            m2 += 1;
        }
    }
    360 * (y2 - y1) + 30 * (m2 as i64 - m1 as i64) + (d2 as i64 - d1 as i64)
}

/// Days between two `(year, month, day)` dates under European 30/360:
/// both days are clamped to 30, no February special-casing.
pub fn days360_eu(start: (i64, u32, u32), end: (i64, u32, u32)) -> i64 {
    let (y1, m1, d1) = start;
    let (y2, m2, d2) = end;
    360 * (y2 - y1) + 30 * (m2 as i64 - m1 as i64) + (d2.min(30) as i64 - d1.min(30) as i64)
}

/// Day count between two serials under `basis`. Bases 1/2/3 are plain
/// serial subtraction; 0 and 4 apply the 30/360 adjustments.
/// Returns `None` on out-of-domain serials (callers map to `#NUM!`).
pub fn days_between(start: i64, end: i64, basis: DayCountBasis, system: DateSystem) -> Option<i64> {
    match basis {
        DayCountBasis::Us30_360 => Some(days360_us(
            date_serial::serial_to_date(start, system)?,
            date_serial::serial_to_date(end, system)?,
            system,
        )),
        DayCountBasis::Eur30_360 => Some(days360_eu(
            date_serial::serial_to_date(start, system)?,
            date_serial::serial_to_date(end, system)?,
        )),
        DayCountBasis::ActAct | DayCountBasis::Act360 | DayCountBasis::Act365 => Some(end - start),
    }
}

/// Whether a Feb 29 occurs anywhere in the closed serial interval
/// `[start, end]`. Used for the basis-1 multi-year denominator.
fn leap_day_within(start: i64, end: i64, system: DateSystem) -> bool {
    let (y1, ..) = match date_serial::serial_to_date(start, system) {
        Some(t) => t,
        None => return false,
    };
    let (y2, ..) = match date_serial::serial_to_date(end, system) {
        Some(t) => t,
        None => return false,
    };
    (y1..=y2).any(|y| {
        date_serial::is_leap_year(y, system)
            && date_serial::date_to_serial(y, 2, 29, system).is_some_and(|s| s >= start && s <= end)
    })
}

/// Year fraction between two serials under `basis` — the `YEARFRAC`
/// kernel. `start > end` is not swapped here; the result is negative
/// (function layer decides sign policy — see spec's open question).
///
/// Basis-1 denominator (SPEC-OPEN): same-year intervals divide by that
/// year's length; multi-year intervals divide by 366 when a Feb 29
/// lies inside the interval, else 365.
pub fn year_fraction(
    start: i64,
    end: i64,
    basis: DayCountBasis,
    system: DateSystem,
) -> Option<f64> {
    let numerator = days_between(start, end, basis, system)? as f64;
    let denominator = match basis {
        DayCountBasis::Us30_360 | DayCountBasis::Eur30_360 | DayCountBasis::Act360 => 360.0,
        DayCountBasis::Act365 => 365.0,
        DayCountBasis::ActAct => {
            let (y1, ..) = date_serial::serial_to_date(start, system)?;
            let (y2, ..) = date_serial::serial_to_date(end, system)?;
            if y1 == y2 {
                if date_serial::is_leap_year(y1, system) {
                    366.0
                } else {
                    365.0
                }
            } else if leap_day_within(start.min(end), start.max(end), system) {
                366.0
            } else {
                365.0
            }
        }
    };
    Some(numerator / denominator)
}

// -------------------------------------------------------------------
// Coupon schedule
// -------------------------------------------------------------------

/// Months per coupon period for `frequency` (1→12, 2→6, 4→3);
/// `None` for invalid frequencies (callers map to `#NUM!`).
pub fn months_per_period(frequency: i64) -> Option<i64> {
    match frequency {
        1 | 2 | 4 => Some(12 / frequency),
        _ => None,
    }
}

/// The coupon date `periods` whole coupon periods before `maturity`
/// (a `(year, month, day)` triple), stepping back `step` months each.
/// Sticky EOM: when `maturity` is on month end, every coupon date is
/// on its month end; otherwise the maturity day-of-month is clipped
/// to the target month's length (SPEC-OPEN: clip vs carry).
pub fn coupon_date_back(
    maturity: (i64, u32, u32),
    periods: i64,
    step_months: i64,
    system: DateSystem,
) -> Option<(i64, u32, u32)> {
    let (y, m, d) = maturity;
    let total = y
        .checked_mul(12)?
        .checked_add(m as i64 - 1)?
        .checked_sub(periods.checked_mul(step_months)?)?;
    let ny = total.div_euclid(12);
    let nm = total.rem_euclid(12) as u32 + 1;
    let eom = is_month_end(y, m, d, system);
    let nd = if eom {
        date_serial::days_in_month(ny, nm, system)
    } else {
        d.min(date_serial::days_in_month(ny, nm, system))
    };
    Some((ny, nm, nd))
}

/// Serial of the coupon date `periods` periods before `maturity`.
fn coupon_serial_back(
    maturity_serial: i64,
    periods: i64,
    step_months: i64,
    system: DateSystem,
) -> Option<i64> {
    let m = date_serial::serial_to_date(maturity_serial, system)?;
    let (y, mo, d) = coupon_date_back(m, periods, step_months, system)?;
    date_serial::date_to_serial(y, mo, d as i64, system)
}

/// The coupon period containing `settlement` for a schedule anchored
/// at `maturity` with `frequency` coupons per year.
///
/// `pcd` is the latest coupon date `<= settlement` (the `COUPPCD`
/// value); `ncd` the first coupon date `> settlement` (`COUPNCD`);
/// `remaining` is the number of coupon dates in `(settlement,
/// maturity]` (`COUPNUM`). Returns `None` when `settlement >=
/// maturity`, the schedule would leave the serial domain, or
/// `frequency` is invalid — callers distinguish `#NUM!` causes.
pub struct CouponSchedule {
    pub pcd: i64,
    pub ncd: i64,
    /// Period index of `pcd`/`ncd`: `ncd` is `remaining` steps before
    /// maturity.
    pub remaining: i64,
}

pub fn coupon_schedule(
    settlement: i64,
    maturity: i64,
    frequency: i64,
    system: DateSystem,
) -> Option<CouponSchedule> {
    if settlement >= maturity {
        return None;
    }
    let step = months_per_period(frequency)?;
    // Estimate how many whole periods lie between settlement and
    // maturity from the month gap, then correct by inspection.
    let (sy, sm, _) = date_serial::serial_to_date(settlement, system)?;
    let (my, mm, _) = date_serial::serial_to_date(maturity, system)?;
    let months = (my - sy) * 12 + (mm as i64 - sm as i64);
    // Find the pcd index k: coupon(k) <= settlement < coupon(k-1).
    let mut k = (months / step).max(0) + 1;
    while coupon_serial_back(maturity, k, step, system)? > settlement {
        k += 1;
        if k > 4_000_000 {
            return None; // schedule left the serial domain
        }
    }
    while k > 1
        && matches!(
            coupon_serial_back(maturity, k - 1, step, system),
            Some(s) if s <= settlement
        )
    {
        k -= 1;
    }
    let pcd = coupon_serial_back(maturity, k, step, system)?;
    let ncd = coupon_serial_back(maturity, k - 1, step, system)?;
    Some(CouponSchedule {
        pcd,
        ncd,
        remaining: k,
    })
}

/// Length of the coupon period `[pcd, ncd]` under `basis` (the
/// `COUPDAYS` value): `360/frequency` for bases 0/2/4, `365/frequency`
/// for basis 3 (fractional for frequency 2/4 — SPEC-OPEN whether Excel
/// truncates), actual days for basis 1.
pub fn coupon_period_days(
    basis: DayCountBasis,
    frequency: i64,
    pcd: i64,
    ncd: i64,
    system: DateSystem,
) -> Option<f64> {
    let f = frequency as f64;
    Some(match basis {
        DayCountBasis::Us30_360 | DayCountBasis::Act360 | DayCountBasis::Eur30_360 => 360.0 / f,
        DayCountBasis::Act365 => 365.0 / f,
        DayCountBasis::ActAct => {
            let _ = system;
            (ncd - pcd) as f64
        }
    })
}

// -------------------------------------------------------------------
// Cash-flow math and the rate solver
// -------------------------------------------------------------------

/// `Σ amounts[i] / (1+rate)^times[i]`. `times` are in periods (any
/// consistent unit). Returns `None` when `rate <= -1` (outside the
/// discounting domain) or inputs are non-finite.
pub fn npv(rate: f64, times: &[f64], amounts: &[f64]) -> Option<f64> {
    if !rate.is_finite() || rate <= -1.0 || times.len() != amounts.len() {
        return None;
    }
    let base = 1.0 + rate;
    let mut acc = 0.0;
    for (&t, &a) in times.iter().zip(amounts) {
        if !t.is_finite() || !a.is_finite() {
            return None;
        }
        acc += a * base.powf(-t);
    }
    acc.is_finite().then_some(acc)
}

/// `Σ amounts[i] / (1+rate)^((dates[i] - dates[0])/365)` — the `XNPV`
/// kernel, fixed actual/365 day count. Returns `None` for `rate <= -1`
/// or empty input.
pub fn xnpv(rate: f64, dates: &[i64], amounts: &[f64]) -> Option<f64> {
    if dates.is_empty() || dates.len() != amounts.len() {
        return None;
    }
    let d0 = dates[0] as f64;
    let times: Vec<f64> = dates.iter().map(|d| (*d as f64 - d0) / 365.0).collect();
    npv(rate, &times, amounts)
}

/// `d/dr Σ a_i (1+r)^(-t_i)` — analytic derivative for Newton steps.
fn npv_derivative(rate: f64, times: &[f64], amounts: &[f64]) -> f64 {
    let base = 1.0 + rate;
    times
        .iter()
        .zip(amounts)
        .map(|(&t, &a)| -t * a * base.powf(-t - 1.0))
        .sum()
}

/// Solve `Σ amounts[i] / (1+r)^times[i] = 0` for `r > -1`.
///
/// Newton iteration from `guess` (clamped into the domain), falling
/// back to bisection over an expanding bracket. Returns `None` when no
/// sign change exists in the reachable bracket or iteration diverges —
/// the defined-failure contract callers map to `#NUM!`. All-positive
/// or all-negative flows fail fast (no root possible).
pub fn solve_rate(times: &[f64], amounts: &[f64], guess: f64) -> Option<f64> {
    if times.is_empty() || times.len() != amounts.len() {
        return None;
    }
    if !amounts.iter().any(|&a| a > 0.0) || !amounts.iter().any(|&a| a < 0.0) {
        return None;
    }
    // Newton with domain clamping.
    let mut r = if guess.is_finite() { guess } else { 0.1 }.max(-0.999999);
    for _ in 0..50 {
        let f = npv(r, times, amounts)?;
        if f.abs() < 1e-12 {
            return Some(r);
        }
        let d = npv_derivative(r, times, amounts);
        if !d.is_finite() || d == 0.0 {
            break;
        }
        let next = (r - f / d).max(-0.999999);
        if (next - r).abs() < 1e-12 * (1.0 + r.abs()) {
            return Some(next);
        }
        r = next;
    }
    // Bisection over an expanding bracket: f(r) → Σ_{t=0} a_i as
    // r → ∞ (dominated by t=0 terms); → sign of largest-t flow as
    // r → -1⁺.
    let f = |x: f64| npv(x, times, amounts);
    let mut lo = -0.9999999;
    let mut hi = (guess.max(0.0)) + 0.5;
    let mut flo = f(lo)?;
    let mut fhi = f(hi)?;
    // Widen the low end toward -1 only if needed is pointless (it is a
    // vertical asymptote); expand hi upward until a sign change.
    for _ in 0..200 {
        if flo == 0.0 {
            return Some(lo);
        }
        if flo.signum() != fhi.signum() {
            break;
        }
        hi = hi * 2.0 + 0.5;
        if hi > 1e10 {
            return None;
        }
        fhi = f(hi)?;
        // Re-check lo in case of numerical noise at the asymptote.
        flo = f(lo)?;
    }
    if flo.signum() == fhi.signum() {
        return None;
    }
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        let fm = f(mid)?;
        if fm == 0.0 || (hi - lo) < 1e-12 * (1.0 + mid.abs()) {
            return Some(mid);
        }
        if fm.signum() == flo.signum() {
            lo = mid;
            flo = fm;
        } else {
            hi = mid;
        }
    }
    Some(0.5 * (lo + hi))
}

// -------------------------------------------------------------------
// Annuity primitives (PMT / PV / FV closed forms)
// -------------------------------------------------------------------

/// `(1+r)^n - 1` computed without catastrophic cancellation for tiny
/// `r` via `expm1(n·ln1p(r))`.
fn growth_minus_one(rate: f64, nper: f64) -> f64 {
    if rate.abs() < 1e-5 {
        // `ln_1p` keeps the increment exact; `1+rate` rounds at ~1e-16
        // which is a large relative error when `rate` is tiny.
        (nper * rate.ln_1p()).exp_m1()
    } else {
        (1.0 + rate).powf(nper) - 1.0
    }
}

/// Periodic payment for an annuity: the `PMT` closed form.
/// `type` `0` = end-of-period, nonzero = beginning.
/// `rate == 0`: `-(pv + fv) / nper`. Returns a non-finite quotient
/// (caller maps to `#DIV/0!`/`#NUM!`) when `nper == 0`.
pub fn annuity_pmt(rate: f64, nper: f64, pv: f64, fv: f64, typ: f64) -> f64 {
    if rate == 0.0 {
        -(pv + fv) / nper
    } else {
        let g = growth_minus_one(rate, nper);
        -(pv * (1.0 + g) + fv) * rate / ((1.0 + rate * typ) * g)
    }
}

/// Future value of an annuity: the `FV` closed form.
/// `rate == 0`: `-(pv + pmt·nper·(no growth))` i.e. `-(pv + pmt*nper)`.
pub fn annuity_fv(rate: f64, nper: f64, pmt: f64, pv: f64, typ: f64) -> f64 {
    if rate == 0.0 {
        -(pv + pmt * nper)
    } else {
        let g = growth_minus_one(rate, nper);
        -(pv * (1.0 + g) + pmt * (1.0 + rate * typ) * g / rate)
    }
}

/// Present value of an annuity: the `PV` closed form.
/// `rate == 0`: `-(fv + pmt·nper)`.
pub fn annuity_pv(rate: f64, nper: f64, pmt: f64, fv: f64, typ: f64) -> f64 {
    if rate == 0.0 {
        -(fv + pmt * nper)
    } else {
        let g = growth_minus_one(rate, nper);
        -(fv + pmt * (1.0 + rate * typ) * g / rate) / (1.0 + g)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use calc_core::workbook::DateSystem::Excel1900 as S;

    fn ser(y: i64, m: u32, d: i64) -> i64 {
        date_serial::date_to_serial(y, m, d, S).unwrap()
    }

    fn ymd(serial: i64) -> (i64, u32, u32) {
        date_serial::serial_to_date(serial, S).unwrap()
    }

    // ---------- 30/360 day counts ----------

    #[test]
    fn us30360_full_year() {
        // A same-day-of-month pair one year apart is exactly 360 under
        // 30/360. (The YEARFRAC spec's `45000 -> 45360` pair is not —
        // it's 2023-03-15 to 2024-03-09, 354 NASD days.)
        let a = ser(2023, 3, 15);
        let b = ser(2024, 3, 15);
        assert_eq!(days_between(a, b, DayCountBasis::Us30_360, S), Some(360));
        assert_eq!(
            year_fraction(a, b, DayCountBasis::Us30_360, S).unwrap(),
            1.0
        );
        // The spec pair itself: 354/360.
        assert_eq!(
            days_between(45000, 45360, DayCountBasis::Us30_360, S),
            Some(354)
        );
    }

    #[test]
    fn us30360_feb_end_special_case() {
        // Start on Feb's last day counts as day 30 under NASD; EU does
        // not adjust — distinguishes the two conventions.
        let feb28 = ser(2023, 2, 28);
        let mar1 = ser(2023, 3, 1);
        assert_eq!(
            days_between(feb28, mar1, DayCountBasis::Us30_360, S),
            Some(1)
        );
        assert_eq!(
            days_between(feb28, mar1, DayCountBasis::Eur30_360, S),
            Some(3)
        );
    }

    #[test]
    fn us30360_31st_adjustments() {
        // Jan 31 -> Mar 31: d1=30, d2=31 with d1==30 -> d2=30 => 60.
        let a = ser(2023, 1, 31);
        let b = ser(2023, 3, 31);
        assert_eq!(days_between(a, b, DayCountBasis::Us30_360, S), Some(60));
        // Jan 30 -> Mar 31: same under both (d2=31, d1=30 -> 30).
        let a = ser(2023, 1, 30);
        assert_eq!(days_between(a, b, DayCountBasis::Us30_360, S), Some(60));
        // Jan 29 -> Mar 31 (US): d1=29 <30, end 31 rolls to Apr 1 => 62.
        let a = ser(2023, 1, 29);
        assert_eq!(days_between(a, b, DayCountBasis::Us30_360, S), Some(62));
        // EU clamps both to 30 => 61.
        assert_eq!(days_between(a, b, DayCountBasis::Eur30_360, S), Some(61));
    }

    #[test]
    fn us30360_both_feb_end() {
        // Both endpoints on Feb's last day: d2 stays 30.
        let a = ser(2023, 2, 28);
        let b = ser(2024, 2, 29); // leap-year Feb end
        assert_eq!(days_between(a, b, DayCountBasis::Us30_360, S), Some(360));
    }

    #[test]
    fn actual_bases_are_serial_diffs() {
        for b in [
            DayCountBasis::ActAct,
            DayCountBasis::Act360,
            DayCountBasis::Act365,
        ] {
            assert_eq!(days_between(45000, 45110, b, S), Some(110));
        }
    }

    // ---------- year_fraction ----------

    #[test]
    fn yearfrac_basis2_and_3() {
        // Spec examples: /360 -> 1.0, /365 -> 360/365.
        assert_eq!(
            year_fraction(45000, 45360, DayCountBasis::Act360, S).unwrap(),
            1.0
        );
        let f = year_fraction(45000, 45360, DayCountBasis::Act365, S).unwrap();
        assert!((f - 360.0 / 365.0).abs() < 1e-12);
    }

    #[test]
    fn yearfrac_same_date_and_reversed() {
        assert_eq!(
            year_fraction(45000, 45000, DayCountBasis::Us30_360, S),
            Some(0.0)
        );
        // Reversed interval is negative (no swap at this layer).
        let f = year_fraction(45000, 44900, DayCountBasis::Us30_360, S).unwrap();
        assert!(f < 0.0);
    }

    #[test]
    fn yearfrac_actact_leap_denominator() {
        // Same year non-leap: 100 days / 365.
        let a = ser(2023, 1, 1);
        let b = ser(2023, 4, 11);
        let f = year_fraction(a, b, DayCountBasis::ActAct, S).unwrap();
        assert!((f - 100.0 / 365.0).abs() < 1e-12);
        // Same year leap: /366.
        let a = ser(2024, 1, 1);
        let b = ser(2024, 4, 11);
        let f = year_fraction(a, b, DayCountBasis::ActAct, S).unwrap();
        assert!((f - 101.0 / 366.0).abs() < 1e-12);
        // Spanning a leap day: denominator 366 per our SPEC-OPEN rule.
        let a = ser(2023, 7, 1);
        let b = ser(2024, 7, 1);
        let f = year_fraction(a, b, DayCountBasis::ActAct, S).unwrap();
        assert!((f - 366.0 / 366.0).abs() < 1e-12);
        // Spanning years with no Feb 29 inside: denominator 365.
        let a = ser(2023, 3, 1);
        let b = ser(2024, 2, 1);
        let f = year_fraction(a, b, DayCountBasis::ActAct, S).unwrap();
        assert!((f - (b - a) as f64 / 365.0).abs() < 1e-12);
    }

    // ---------- coupon schedule ----------

    #[test]
    fn coupon_ncd_pcd_examples() {
        // COUPNCD/COUPPCD doc examples: settlement 2007-01-25,
        // maturity 2008-11-15, freq 2.
        let st = ser(2007, 1, 25);
        let mat = ser(2008, 11, 15);
        let s = coupon_schedule(st, mat, 2, S).unwrap();
        assert_eq!(s.ncd, 39217); // 2007-05-15
        assert_eq!(s.pcd, 39036); // 2006-11-15
        assert_eq!(s.remaining, 4); // COUPNUM
    }

    #[test]
    fn coupon_settlement_on_coupon_date() {
        // Settlement on a coupon date: PCD = that date, NCD = next.
        let st = ser(2007, 5, 15);
        let mat = ser(2008, 11, 15);
        let s = coupon_schedule(st, mat, 2, S).unwrap();
        assert_eq!(s.pcd, st); // 39217
        assert_eq!(s.ncd, 39401); // 2007-11-15
        assert_eq!(s.remaining, 3);
    }

    #[test]
    fn coupon_quarterly() {
        // COUPNCD freq 4 -> 39128 (2007-02-15); COUPNUM -> 8.
        let st = ser(2007, 1, 25);
        let mat = ser(2008, 11, 15);
        let s = coupon_schedule(st, mat, 4, S).unwrap();
        assert_eq!(s.ncd, 39128);
        assert_eq!(s.remaining, 8);
    }

    #[test]
    fn coupon_invalid_inputs() {
        let st = ser(2008, 11, 15);
        assert!(coupon_schedule(st, st, 2, S).is_none()); // settlement == maturity
        assert!(coupon_schedule(st, st - 1, 2, S).is_none());
        assert!(coupon_schedule(st - 100, st, 3, S).is_none()); // bad frequency
        assert!(coupon_schedule(st - 100, st, 0, S).is_none());
    }

    #[test]
    fn coupon_eom_sticky() {
        // Maturity Aug 31 -> Feb coupon is Feb's last day (sticky EOM).
        let st = ser(2007, 3, 1);
        let mat = ser(2008, 8, 31);
        let s = coupon_schedule(st, mat, 2, S).unwrap();
        assert_eq!(ymd(s.pcd), (2007, 2, 28));
        assert_eq!(ymd(s.ncd), (2007, 8, 31));
    }

    #[test]
    fn coupon_period_lengths() {
        // COUPDAYS examples.
        let st = ser(2007, 1, 25);
        let mat = ser(2008, 11, 15);
        let s = coupon_schedule(st, mat, 2, S).unwrap();
        assert_eq!(
            coupon_period_days(DayCountBasis::ActAct, 2, s.pcd, s.ncd, S),
            Some(181.0)
        );
        assert_eq!(
            coupon_period_days(DayCountBasis::Us30_360, 2, s.pcd, s.ncd, S),
            Some(180.0)
        );
        assert_eq!(
            coupon_period_days(DayCountBasis::Act365, 2, s.pcd, s.ncd, S),
            Some(182.5)
        );
        assert_eq!(
            coupon_period_days(DayCountBasis::Us30_360, 4, s.pcd, s.ncd, S),
            Some(90.0)
        );
    }

    #[test]
    fn coupon_daybs_and_daysnc() {
        // COUPDAYBS basis1=71, basis0=70; COUPDAYSNC basis1=110, basis0=110.
        let st = ser(2007, 1, 25);
        let mat = ser(2008, 11, 15);
        let s = coupon_schedule(st, mat, 2, S).unwrap();
        assert_eq!(days_between(s.pcd, st, DayCountBasis::ActAct, S), Some(71));
        assert_eq!(
            days_between(s.pcd, st, DayCountBasis::Us30_360, S),
            Some(70)
        );
        assert_eq!(days_between(st, s.ncd, DayCountBasis::ActAct, S), Some(110));
        assert_eq!(
            days_between(st, s.ncd, DayCountBasis::Us30_360, S),
            Some(110)
        );
        // Settlement on coupon date -> next period: COUPDAYSNC = 184.
        let st = ser(2007, 5, 15);
        let s = coupon_schedule(st, mat, 2, S).unwrap();
        assert_eq!(days_between(st, s.ncd, DayCountBasis::ActAct, S), Some(184));
    }

    // ---------- npv / xnpv ----------

    #[test]
    fn npv_basic() {
        let v = npv(0.1, &[1.0, 2.0], &[100.0, 100.0]).unwrap();
        assert!((v - (100.0 / 1.1 + 100.0 / 1.21)).abs() < 1e-10);
    }

    #[test]
    fn npv_domain() {
        assert!(npv(-1.0, &[1.0], &[1.0]).is_none());
        assert!(npv(-1.5, &[1.0], &[1.0]).is_none());
        assert!(npv(0.1, &[1.0], &[f64::NAN]).is_none());
        assert!(npv(0.1, &[1.0, 2.0], &[1.0]).is_none()); // length mismatch
    }

    #[test]
    fn xnpv_basic() {
        // -1000 at d0, +1100 one year later, rate 0.1 -> ~0.
        let v = xnpv(0.1, &[45000, 45365], &[-1000.0, 1100.0]).unwrap();
        assert!(v.abs() < 1e-8);
    }

    // ---------- solve_rate ----------

    #[test]
    fn solve_irr_doc_example() {
        // IRR({-70000,12000,15000,18000,21000,26000}) = 0.086630948.
        let times: Vec<f64> = (0..6).map(|i| i as f64).collect();
        let amounts = [-70000.0, 12000.0, 15000.0, 18000.0, 21000.0, 26000.0];
        let r = solve_rate(&times, &amounts, 0.1).unwrap();
        assert!((r - 0.086630948).abs() < 1e-7);
    }

    #[test]
    fn solve_xirr_doc_example() {
        // XIRR doc example ≈ 0.3734 — dates 2008-01-01, 2008-03-01,
        // 2008-10-30, 2009-02-15, 2009-04-01.
        let dates = [39448, 39508, 39751, 39859, 39904];
        let amounts = [-10000.0, 2750.0, 4250.0, 3250.0, 2750.0];
        let d0 = dates[0] as f64;
        let times: Vec<f64> = dates.iter().map(|d| (*d as f64 - d0) / 365.0).collect();
        let r = solve_rate(&times, &amounts, 0.1).unwrap();
        assert!((r - 0.373362535).abs() < 1e-5);
    }

    #[test]
    fn solve_simple_doubling() {
        // -1000 now, +1100 in exactly one year -> 0.1.
        let r = solve_rate(&[0.0, 1.0], &[-1000.0, 1100.0], 0.1).unwrap();
        assert!((r - 0.1).abs() < 1e-10);
    }

    #[test]
    fn solve_no_sign_change_fails() {
        assert!(solve_rate(&[0.0, 1.0], &[100.0, 200.0], 0.1).is_none());
        assert!(solve_rate(&[0.0, 1.0], &[-100.0, -200.0], 0.1).is_none());
        assert!(solve_rate(&[], &[], 0.1).is_none());
    }

    #[test]
    fn solve_high_rate_via_bracket_expansion() {
        // -100 now, +10000 in one period -> r = 99 (Newton from 0.1
        // may miss; bracket expansion must recover it).
        let r = solve_rate(&[0.0, 1.0], &[-100.0, 10000.0], 0.1).unwrap();
        assert!((r - 99.0).abs() < 1e-6);
    }

    // ---------- annuities ----------

    #[test]
    fn pmt_doc_examples() {
        // PMT(0.005, 36, 10000) ≈ -304.219.
        let p = annuity_pmt(0.005, 36.0, 10000.0, 0.0, 0.0);
        assert!((p + 304.2194).abs() < 1e-3);
        // PMT(0, 12, 1200) = -100.
        assert_eq!(annuity_pmt(0.0, 12.0, 1200.0, 0.0, 0.0), -100.0);
        // Type 1 discounts one extra period: ≈ -302.7058.
        let p = annuity_pmt(0.005, 36.0, 10000.0, 0.0, 1.0);
        assert!((p + 302.7058).abs() < 1e-3);
        // PMT(0.05, 10, 0, -10000) ≈ +795.046 (negative fv inverts the
        // usual outflow sign — spec doc lists -795.046, verified).
        let p = annuity_pmt(0.05, 10.0, 0.0, -10000.0, 0.0);
        assert!((p - 795.046).abs() < 1e-2);
        // Positive savings target -> negative payment.
        let p = annuity_pmt(0.05, 10.0, 0.0, 10000.0, 0.0);
        assert!((p + 795.046).abs() < 1e-2);
    }

    #[test]
    fn pmt_tiny_rate_stability() {
        // rate=1e-12 must not blow up via cancellation.
        let p = annuity_pmt(1e-12, 12.0, 1200.0, 0.0, 0.0);
        assert!((p + 100.0).abs() < 1e-5);
    }

    #[test]
    fn pv_fv_roundtrip() {
        // PV of a payment stream then FV of it returns to the same
        // balance: pv -> fv over n periods at r.
        let pv = annuity_pv(0.005, 36.0, -304.2194, 0.0, 0.0);
        assert!((pv - 10000.0).abs() < 1e-2);
        let fv = annuity_fv(0.005, 36.0, -304.2194, 10000.0, 0.0);
        assert!(fv.abs() < 1.0); // loan fully amortized
        // rate==0 limits.
        assert_eq!(annuity_pv(0.0, 10.0, -100.0, -500.0, 0.0), 1500.0);
        assert_eq!(annuity_fv(0.0, 10.0, -100.0, -500.0, 0.0), 1500.0);
    }
}
