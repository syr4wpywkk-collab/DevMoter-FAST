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
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::Function;
use calc_core::value::Value;

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
mod fv;
mod fvschedule;
mod intrate;
mod ipmt;
mod irr;
mod ispmt;
mod mduration;
mod mirr;
mod nominal;
mod nper;
mod npv;
mod oddfprice;
mod oddfyield;
mod oddlprice;
mod oddlyield;
mod pduration;
mod pmt;
mod ppmt;
mod price;
mod pricedisc;
mod pricemat;
mod pv;
mod rate;
mod received;
mod rri;
mod sln;
mod syd;
mod tbilleq;
mod tbillprice;
mod tbillyield;
mod vdb;
mod xirr;
mod xnpv;
mod yield_fn;
mod yielddisc;
mod yieldmat;

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
    ("FV", fv::call),
    ("FVSCHEDULE", fvschedule::call),
    ("INTRATE", intrate::call),
    ("IPMT", ipmt::call),
    ("IRR", irr::call),
    ("ISPMT", ispmt::call),
    ("MDURATION", mduration::call),
    ("MIRR", mirr::call),
    ("NOMINAL", nominal::call),
    ("NPER", nper::call),
    ("NPV", npv::call),
    ("ODDFPRICE", oddfprice::call),
    ("ODDFYIELD", oddfyield::call),
    ("ODDLPRICE", oddlprice::call),
    ("ODDLYIELD", oddlyield::call),
    ("PDURATION", pduration::call),
    ("PMT", pmt::call),
    ("PPMT", ppmt::call),
    ("PRICE", price::call),
    ("PRICEDISC", pricedisc::call),
    ("PRICEMAT", pricemat::call),
    ("PV", pv::call),
    ("RATE", rate::call),
    ("RECEIVED", received::call),
    ("RRI", rri::call),
    ("SLN", sln::call),
    ("SYD", syd::call),
    ("TBILLEQ", tbilleq::call),
    ("TBILLPRICE", tbillprice::call),
    ("TBILLYIELD", tbillyield::call),
    ("VDB", vdb::call),
    ("XIRR", xirr::call),
    ("XNPV", xnpv::call),
    ("YIELD", yield_fn::call),
    ("YIELDDISC", yielddisc::call),
    ("YIELDMAT", yieldmat::call),
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

/// Shared argument parsing for the bond functions: evaluate a scalar
/// date argument (truncated to a whole-day serial).
pub(crate) fn date_arg(
    ctx: &mut calc_core::eval::EvalContext<'_>,
    arg: &calc_core::ast::Expr,
) -> Result<Result<i64, calc_core::error::CalcError>, calc_core::eval::EvalError> {
    match crate::common::coercion::eval_number(ctx, arg)? {
        Err(e) => Ok(Err(e)),
        Ok(n) => Ok(Ok(crate::common::date_serial::trunc_to_i64(n))),
    }
}

/// Required numeric argument (direct-scalar coercion; errors
/// propagate). `Err(CalcError)` is the error to emit.
pub(crate) fn arg_num(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    i: usize,
) -> Result<Result<f64, CalcError>, EvalError> {
    Ok(ctx.eval(&args[i])?.to_number())
}

/// Optional numeric argument; `Missing`/absent yields `default`
/// (a supplied blank cell coerces to `0.0` via `to_number`, matching
/// Excel's blank-optional rule).
pub(crate) fn opt_num(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    i: usize,
    default: f64,
) -> Result<Result<f64, CalcError>, EvalError> {
    match args.get(i) {
        Some(Expr::Missing) | None => Ok(Ok(default)),
        Some(e) => Ok(ctx.eval(e)?.to_number()),
    }
}

/// Optional day-count basis (default `0`); a code outside `0..=4`
/// yields `CalcError::Num`.
pub(crate) fn arg_basis(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    i: usize,
) -> Result<Result<DayCountBasis, CalcError>, EvalError> {
    match opt_num(ctx, args, i, 0.0)? {
        Err(e) => Ok(Err(e)),
        Ok(v) => Ok(
            match DayCountBasis::from_code(date_serial::trunc_to_i64(v)) {
                Some(b) => Ok(b),
                None => Err(CalcError::Num),
            },
        ),
    }
}

/// Required date argument: numeric serial truncated toward zero
/// (financial date args truncate the fractional part, matching the
/// COUP* family convention).
pub(crate) fn arg_date(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
    i: usize,
) -> Result<Result<i64, CalcError>, EvalError> {
    Ok(ctx
        .eval(&args[i])?
        .to_number()
        .map(date_serial::trunc_to_i64))
}

/// Flattened members of one argument in row-major order as
/// `(value, range_derived)` pairs — positional pairing for the
/// `XIRR`/`XNPV` two-array functions. Scalars and single refs are
/// one-element vectors.
pub(crate) fn arg_members(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Vec<(Value, bool)>, EvalError> {
    Ok(match ctx.eval_arg(arg)? {
        ArgValue::Scalar(Value::Array(a)) | ArgValue::Ref(Value::Array(a)) => {
            // Array literal: members coerce like scalars.
            a.into_iter().map(|v| (v, false)).collect()
        }
        ArgValue::Scalar(v) => vec![(v, false)],
        ArgValue::Ref(v) => vec![(v, true)],
        ArgValue::Range(a) => a.into_iter().map(|v| (v, true)).collect(),
    })
}

/// Member coercion for the values/dates pairs of `XIRR`/`XNPV`:
/// scalars coerce via `to_number`; range members contribute only
/// `Value::Number`s (text/bool/blank are ignored, per the IRR-family
/// range rule — SPEC-OPEN). Errors propagate.
pub(crate) fn member_number(v: &Value, ranged: bool) -> Result<Option<f64>, CalcError> {
    if let Some(e) = v.error() {
        return Err(e);
    }
    if ranged {
        Ok(match v {
            Value::Number(n) => Some(*n),
            _ => None,
        })
    } else {
        v.to_number().map(Some)
    }
}
