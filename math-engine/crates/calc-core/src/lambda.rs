//! First-class lambda values (v2 §3 value model).
//!
//! A [`LambdaValue`] is produced by the `LAMBDA` special form and consumed
//! by invocation sites (`f(args)` where `f` is a bound name, `expr(args)`
//! via [`crate::ast::Expr::Invoke`], or higher-order functions such as
//! `MAP`/`REDUCE`). It captures the lexical scope chain active when it was
//! created, so closures over `LET` bindings work.

use crate::ast::Expr;
use crate::value::Value;

/// An anonymous function: parameter names, a body expression and the
/// captured lexical environment.
///
/// `env` is a flattened snapshot of the scope chain at creation time
/// (outermost-first; later entries shadow earlier ones). Names are stored
/// lower-cased — Excel names are case-insensitive.
#[derive(Debug, Clone, PartialEq)]
pub struct LambdaValue {
    /// Parameter names (lower-cased), bound left-to-right at invocation.
    pub params: Vec<String>,
    /// The calculation expression, evaluated per call.
    pub body: Expr,
    /// Captured scope bindings (outermost-first).
    pub env: Vec<(String, Value)>,
}

impl LambdaValue {
    /// Look up `name` (lower-cased) in the captured environment.
    pub fn env_lookup(&self, name: &str) -> Option<&Value> {
        self.env
            .iter()
            .rev()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v)
    }
}
