//! Function registry and dispatch (plan §6).
//!
//! One file per function so each can be improved and analyzed
//! independently; this module only registers and dispatches. Shared
//! argument/coercion logic lives in [`helpers`].
//!
//! Functions are dispatched by upper-case name. Each receives the
//! *unevaluated* argument expressions plus the [`EvalContext`], so special
//! forms evaluate arguments on demand (lazy `IF`/`IFERROR`, plan §5).
//! Eager functions use [`helpers::flatten_args`].

use crate::ast::Expr;
use crate::error::CalcError;
use crate::eval::{EvalContext, EvalError};
use crate::value::Value;

pub mod helpers;

mod abs;
mod and;
mod average;
mod count;
mod counta;
mod if_fn;
mod iferror;
mod max;
mod min;
mod not;
mod or;
mod round;
mod sum;

/// The common function signature: name-resolved call with unevaluated
/// argument expressions evaluated on demand through `ctx`.
///
/// Ordinary spreadsheet errors are returned as `Value::Error(..)`;
/// `Err(..)` is reserved for fatal engine conditions (step budget, depth)
/// that abort recalculation.
pub type Function = fn(&mut EvalContext<'_>, &[Expr]) -> Result<Value, EvalError>;

/// Dispatch `name` (matched case-insensitively) to its implementation.
/// `None` = unregistered function, which the evaluator maps to `#NAME?`.
pub fn dispatch(
    name: &str,
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Option<Result<Value, EvalError>> {
    let f: Function = lookup(name)?;
    Some(f(ctx, args))
}

/// Names of every registered function (Phase 1: the basic 13).
pub const REGISTERED: &[&str] = &[
    "ABS", "AND", "AVERAGE", "COUNT", "COUNTA", "IF", "IFERROR", "MAX", "MIN", "NOT", "OR",
    "ROUND", "SUM",
];

fn lookup(name: &str) -> Option<Function> {
    let f = match name.to_ascii_uppercase().as_str() {
        "ABS" => abs::call,
        "AND" => and::call,
        "AVERAGE" => average::call,
        "COUNT" => count::call,
        "COUNTA" => counta::call,
        "IF" => if_fn::call,
        "IFERROR" => iferror::call,
        "MAX" => max::call,
        "MIN" => min::call,
        "NOT" => not::call,
        "OR" => or::call,
        "ROUND" => round::call,
        "SUM" => sum::call,
        _ => return None,
    };
    Some(f)
}

/// Maximum arguments a function may take (Excel's 255).
pub const MAX_ARGS: usize = 255;

/// Arity helper shared by function implementations: `Err(CalcError::Value)`
/// when `args.len()` is outside `min..=max`.
///
/// SPEC-OPEN: Excel reports arity problems at formula-entry time rather
/// than as a cell error; the cell-error mapping is provisional.
pub fn check_arity(args: &[Expr], min: usize, max: usize) -> Result<(), CalcError> {
    if args.len() < min || args.len() > max {
        return Err(CalcError::Value);
    }
    Ok(())
}
