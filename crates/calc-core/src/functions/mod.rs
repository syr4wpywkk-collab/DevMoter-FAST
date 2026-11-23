//! Function registry and dispatch (plan §6).
//!
//! Functions are dispatched by upper-case name. Each receives the
//! *unevaluated* argument expressions plus the [`EvalContext`], so special
//! forms can evaluate arguments on demand (lazy `IF`/`IFERROR`, plan §5).
//! Eager functions simply `ctx.eval(arg)` for each argument.
//!
//! Phase 1 functions land in `feat/functions-phase1`, one file per
//! function; this module only owns the signature and dispatch table.

use crate::ast::Expr;
use crate::error::CalcError;
use crate::eval::{EvalContext, EvalError};
use crate::value::Value;

/// The common function signature: name-resolved call with unevaluated
/// argument expressions evaluated on demand through `ctx`.
///
/// Returns `Result<Value, EvalError>`: ordinary spreadsheet errors are
/// returned as `Value::Error(..)`; `Err(..)` is reserved for fatal engine
/// conditions (step budget, depth) that abort recalculation.
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

/// The Phase 1 dispatch table. Filled in by `feat/functions-phase1`.
fn lookup(name: &str) -> Option<Function> {
    let _ = name;
    None
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
