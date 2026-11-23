//! Function dispatch boundary (v2 plan §3).
//!
//! `calc-core` ships *no* function implementations. The evaluator only
//! knows the [`Function`] signature and dispatches calls through a
//! [`FunctionRegistry`] supplied by the caller. `calc-functions`
//! implements the standard registry; engines/tests that need no
//! functions use [`EmptyRegistry`]. This keeps the dependency one-way:
//! `calc-functions` depends on `calc-core`, never the reverse.
//!
//! Functions are dispatched by upper-case name. Each receives the
//! *unevaluated* argument expressions plus the [`EvalContext`], so
//! special forms evaluate arguments on demand (lazy `IF`/`IFERROR`).
//!
//! Ordinary spreadsheet errors are returned as `Value::Error(..)`;
//! `Err(..)` is reserved for fatal engine conditions (step budget,
//! depth) that abort recalculation.

use crate::ast::Expr;
use crate::error::CalcError;
use crate::eval::{EvalContext, EvalError};
use crate::value::Value;

/// The common function signature: name-resolved call with unevaluated
/// argument expressions evaluated on demand through `ctx`.
pub type Function = fn(&mut EvalContext<'_>, &[Expr]) -> Result<Value, EvalError>;

/// Lookup table mapping function names to implementations.
///
/// The evaluator calls [`FunctionRegistry::dispatch`] for every
/// `Expr::Call`; returning `None` maps to `#NAME?`.
pub trait FunctionRegistry {
    /// Resolve `name` (matched case-insensitively) to its
    /// implementation. `None` = unregistered function.
    fn lookup(&self, name: &str) -> Option<Function>;

    /// Dispatch `name` to its implementation. The default body calls
    /// [`FunctionRegistry::lookup`]; registries rarely override this.
    fn dispatch(
        &self,
        name: &str,
        ctx: &mut EvalContext<'_>,
        args: &[Expr],
    ) -> Option<Result<Value, EvalError>> {
        let f: Function = self.lookup(name)?;
        Some(f(ctx, args))
    }

    /// Whether `name` is volatile: cells containing a volatile call are
    /// re-evaluated on every `recalculate()` pass regardless of
    /// dependency changes (`RAND`, `RANDBETWEEN`, `TODAY`, `NOW`).
    /// Default: no function is volatile.
    fn is_volatile(&self, _name: &str) -> bool {
        false
    }
}

/// Registry with no functions: every call evaluates to `#NAME?`.
/// Default for [`crate::CalcEngine::new`] so `calc-core` stays usable
/// (and testable) without `calc-functions`.
#[derive(Debug, Clone, Copy, Default)]
pub struct EmptyRegistry;

impl FunctionRegistry for EmptyRegistry {
    fn lookup(&self, _name: &str) -> Option<Function> {
        None
    }
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
