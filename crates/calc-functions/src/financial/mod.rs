//! Financial functions (v3): `financial/*.rs`, one file per function.
//!
//! Day-count bases, the maturity-anchored coupon schedule and the
//! annuity primitives live in [`crate::common::finance`]; serial
//! conversion in [`crate::common::date_serial`]. The helpers below only
//! own argument coercion and error mapping, mirroring how `datetime`
//! wraps `date_serial`.
//!
//! Unless a spec says otherwise: date arguments truncate toward zero
//! and must land inside the serial domain; `basis` truncates to `0..=4`;
//! `frequency` truncates to `{1, 2, 4}`; violations are `#NUM!`.
//! Non-numeric text is `#VALUE!`; error arguments propagate.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::Function;

use crate::common::{date_serial, finance};
use finance::{CouponSchedule, DayCountBasis};

mod accrint;
mod accrintm;
mod amordegrc;
mod amorlinc;
mod coupdaybs;
mod coupdays;
mod coupdaysnc;
mod coupncd;
mod coupnum;
mod couppcd;
mod cumipmt;
mod cumprinc;
mod db;
mod ddb;
mod disc;
mod dollarde;
mod dollarfr;
mod duration;
mod effect;

/// `(name, implementation)` pairs contributed by this category,
/// consumed by [`crate::registry`].
pub const FUNCTIONS: &[(&str, Function)] = &[
    ("ACCRINT", accrint::call),
    ("ACCRINTM", accrintm::call),
    ("AMORDEGRC", amordegrc::call),
    ("AMORLINC", amorlinc::call),
    ("COUPDAYBS", coupdaybs::call),
    ("COUPDAYS", coupdays::call),
    ("COUPDAYSNC", coupdaysnc::call),
    ("COUPNCD", coupncd::call),
    ("COUPNUM", coupnum::call),
    ("COUPPCD", couppcd::call),
    ("CUMIPMT", cumipmt::call),
    ("CUMPRINC", cumprinc::call),
    ("DB", db::call),
    ("DDB", ddb::call),
    ("DISC", disc::call),
    ("DOLLARDE", dollarde::call),
    ("DOLLARFR", dollarfr::call),
    ("DURATION", duration::call),
    ("EFFECT", effect::call),
];

/// Result alias used by the argument helpers: `Ok(Ok(v))` a coerced
/// value, `Ok(Err(e))` the `CalcError` the function should return,
/// `Err(_)` an evaluation fault to propagate.
type Coerced<T> = Result<Result<T, CalcError>, EvalError>;

/// Evaluate `args[i]` as a scalar number.
pub(crate) fn number_arg(ctx: &mut EvalContext<'_>, args: &[Expr], i: usize) -> Coerced<f64> {
    match ctx.eval(&args[i])?.to_number() {
        Ok(v) => Ok(Ok(v)),
        Err(e) => Ok(Err(e)),
    }
}

/// Evaluate `args[i]` as a scalar number; an absent argument,
/// `Expr::Missing`, or a blank value yields `default`.
pub(crate) fn opt_number_arg(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    i: usize,
    default: f64,
) -> Coerced<f64> {
    match args.get(i) {
        None | Some(Expr::Missing) => Ok(Ok(default)),
        Some(expr) => {
            let v = ctx.eval(expr)?;
            Ok(if v.is_blank() {
                Ok(default)
            } else {
                match v.to_number() {
                    Ok(v) => Ok(v),
                    Err(e) => Err(e),
                }
            })
        }
    }
}

/// Evaluate `args[i]` as a boolean (for `ACCRINT`'s `calc_method`);
/// absent/missing/blank yields `default`.
pub(crate) fn opt_bool_arg(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    i: usize,
    default: bool,
) -> Coerced<bool> {
    match args.get(i) {
        None | Some(Expr::Missing) => Ok(Ok(default)),
        Some(expr) => {
            let v = ctx.eval(expr)?;
            Ok(if v.is_blank() {
                Ok(default)
            } else {
                match v.to_boolean() {
                    Ok(v) => Ok(v),
                    Err(e) => Err(e),
                }
            })
        }
    }
}

/// Evaluate `args[i]` as a date serial: truncated toward zero, must
/// satisfy `0 <= s <= max_serial`; else `#NUM!`.
pub(crate) fn serial_arg(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    i: usize,
    system: calc_core::workbook::DateSystem,
) -> Coerced<i64> {
    match number_arg(ctx, args, i)? {
        Err(e) => Ok(Err(e)),
        Ok(v) => {
            let s = date_serial::trunc_to_i64(v);
            if v < 0.0 || s > date_serial::max_serial(system) {
                Ok(Err(CalcError::Num))
            } else {
                Ok(Ok(s))
            }
        }
    }
}

/// Evaluate a `basis` argument (`0..=4`, default `0`); `#NUM!` out of
/// range. Truncates like Excel (`basis 1.9` -> basis `1`).
pub(crate) fn basis_arg(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    i: usize,
) -> Coerced<DayCountBasis> {
    match opt_number_arg(ctx, args, i, 0.0)? {
        Err(e) => Ok(Err(e)),
        Ok(v) => match DayCountBasis::from_code(date_serial::trunc_to_i64(v)) {
            Some(b) => Ok(Ok(b)),
            None => Ok(Err(CalcError::Num)),
        },
    }
}

/// Evaluate a `frequency` argument (`1`, `2`, `4`); `#NUM!` otherwise.
pub(crate) fn freq_arg(ctx: &mut EvalContext<'_>, args: &[Expr], i: usize) -> Coerced<i64> {
    match number_arg(ctx, args, i)? {
        Err(e) => Ok(Err(e)),
        Ok(v) => match date_serial::trunc_to_i64(v) {
            f @ (1 | 2 | 4) => Ok(Ok(f)),
            _ => Ok(Err(CalcError::Num)),
        },
    }
}

/// The `(settlement, maturity, frequency, basis)` argument quartet the
/// `COUP*`/`DURATION` family shares, plus the resolved coupon schedule.
/// `min_args`/`max_args` select the arity window (`basis` optional).
pub(crate) struct CouponArgs {
    pub schedule: CouponSchedule,
    pub basis: DayCountBasis,
    pub frequency: i64,
    pub settlement: i64,
    pub system: calc_core::workbook::DateSystem,
}

pub(crate) fn coupon_args(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    min_args: usize,
    max_args: usize,
    basis_index: usize,
) -> Coerced<CouponArgs> {
    if let Err(e) = calc_core::registry::check_arity(args, min_args, max_args) {
        return Ok(Err(e));
    }
    let system = ctx.date_system();
    macro_rules! take {
        ($e:expr) => {
            match $e? {
                Ok(v) => v,
                Err(e) => return Ok(Err(e)),
            }
        };
    }
    let settlement = take!(serial_arg(ctx, args, 0, system));
    let maturity = take!(serial_arg(ctx, args, 1, system));
    let frequency = take!(freq_arg(ctx, args, 2));
    let basis = take!(basis_arg(ctx, args, basis_index));
    if settlement >= maturity {
        return Ok(Err(CalcError::Num));
    }
    match finance::coupon_schedule(settlement, maturity, frequency, system) {
        Some(schedule) => Ok(Ok(CouponArgs {
            schedule,
            basis,
            frequency,
            settlement,
            system,
        })),
        None => Ok(Err(CalcError::Num)),
    }
}

/// The `(cost, date_purchased, first_period, salvage, period, rate,
/// basis)` argument list shared by `AMORDEGRC`/`AMORLINC`, including
/// the shared validation surface (LibreOffice parity): `#NUM!` when
/// `date_purchased > first_period`, `rate <= 0`, `salvage > cost`,
/// `cost <= 0`, `salvage < 0`, or `period < 0` (period truncates).
pub(crate) struct AmorArgs {
    pub cost: f64,
    pub purchased: i64,
    pub first_period: i64,
    pub salvage: f64,
    pub period: i64,
    pub rate: f64,
    pub basis: DayCountBasis,
    pub system: calc_core::workbook::DateSystem,
}

pub(crate) fn amor_args(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Coerced<AmorArgs> {
    if let Err(e) = calc_core::registry::check_arity(args, 6, 7) {
        return Ok(Err(e));
    }
    let system = ctx.date_system();
    macro_rules! take {
        ($e:expr) => {
            match $e? {
                Ok(v) => v,
                Err(e) => return Ok(Err(e)),
            }
        };
    }
    let cost = take!(number_arg(ctx, args, 0));
    let purchased = take!(serial_arg(ctx, args, 1, system));
    let first_period = take!(serial_arg(ctx, args, 2, system));
    let salvage = take!(number_arg(ctx, args, 3));
    let period = date_serial::trunc_to_i64(take!(number_arg(ctx, args, 4)));
    let rate = take!(number_arg(ctx, args, 5));
    let basis = take!(basis_arg(ctx, args, 6));
    if purchased > first_period
        || rate <= 0.0
        || salvage > cost
        || cost <= 0.0
        || salvage < 0.0
        || period < 0
    {
        return Ok(Err(CalcError::Num));
    }
    Ok(Ok(AmorArgs {
        cost,
        purchased,
        first_period,
        salvage,
        period,
        rate,
        basis,
        system,
    }))
}

/// The `(rate, nper, pv, start_period, end_period, type)` list shared
/// by `CUMIPMT`/`CUMPRINC`. `#NUM!` when `rate <= 0`, `nper <= 0`,
/// `pv <= 0`, `start < 1`, `end < 1`, `start > end`, `end > nper`
/// (LibreOffice/Excel behavior — the spec marks "silent extension" as
/// confirm-needed and the reference treats it as an error), or
/// `type ∉ {0,1}`. `nper`, `start`, `end` truncate; `type` truncates.
pub(crate) struct CumArgs {
    pub rate: f64,
    pub nper: i64,
    pub pv: f64,
    pub start: i64,
    pub end: i64,
    pub typ: i64,
}

pub(crate) fn cum_args(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Coerced<CumArgs> {
    if let Err(e) = calc_core::registry::check_arity(args, 6, 6) {
        return Ok(Err(e));
    }
    macro_rules! take {
        ($e:expr) => {
            match $e? {
                Ok(v) => v,
                Err(e) => return Ok(Err(e)),
            }
        };
    }
    let rate = take!(number_arg(ctx, args, 0));
    let nper = date_serial::trunc_to_i64(take!(number_arg(ctx, args, 1)));
    let pv = take!(number_arg(ctx, args, 2));
    let start = date_serial::trunc_to_i64(take!(number_arg(ctx, args, 3)));
    let end = date_serial::trunc_to_i64(take!(number_arg(ctx, args, 4)));
    let typ = date_serial::trunc_to_i64(take!(number_arg(ctx, args, 5)));
    if rate <= 0.0
        || nper <= 0
        || pv <= 0.0
        || start < 1
        || end < 1
        || start > end
        || end > nper
        || !(0..=1).contains(&typ)
    {
        return Ok(Err(CalcError::Num));
    }
    Ok(Ok(CumArgs {
        rate,
        nper,
        pv,
        start,
        end,
        typ,
    }))
}

/// Interest portion of the payment in period `per` (1-based) for a
/// `pv`-principal loan at `rate` per period with payment `pmt`
/// (negative, the [`finance::annuity_pmt`] convention):
/// `-rate * balance`, where the balance is measured after `per-1`
/// ordinary payments (`type = 0`), or after `per` beginning-of-period
/// payments (`type = 1` — period 1's due payment reduces the principal
/// before interest accrues).
pub(crate) fn ipmt(rate: f64, per: i64, pv: f64, pmt: f64, typ: i64) -> f64 {
    let k = per as f64;
    let balance = if typ == 0 {
        let g = (1.0 + rate).powf(k - 1.0);
        pv * g + pmt * (g - 1.0) / rate
    } else {
        let g = (1.0 + rate).powf(k);
        pv * g + pmt * (1.0 + rate) * (g - 1.0) / rate
    };
    -rate * balance
}
