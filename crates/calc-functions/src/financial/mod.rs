//! Financial functions (v3): `financial/*.rs`, one file per function.
//!
//! Shared conventions (day-count bases, coupon schedules, the NPV /
//! rate solver, annuity closed forms) live in
//! [`crate::common::finance`]; this module only owns argument-helpers
//! used across several functions in the category.
//!
//! To add a function: create `financial/<name>.rs` with a `pub fn call`,
//! then add one `("<NAME>", <name>::call)` line to [`FUNCTIONS`].
//!
//! Note: `yield` is a Rust keyword, so the YIELD file is `yield_fn.rs`
//! (same convention as `logical/if_fn.rs`).

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::registry::Function;
use calc_core::value::Value;

use crate::common::date_serial;
use crate::common::finance::DayCountBasis;

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
