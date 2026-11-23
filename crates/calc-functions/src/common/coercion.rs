//! Implicit coercion layer (v2 §3): the single owner of Excel's
//! argument-conversion rules.
//!
//! The central distinction is *direct scalar* vs *range-derived* values
//! (see `docs/functions/README.md`): scalars coerce via
//! [`Value::to_number`]/[`Value::to_boolean`]; range members (from `A1`
//! refs and `A1:B2` ranges alike) are ignored unless they are numbers —
//! except where a function's spec says otherwise.
//!
//! Lazy special forms (`IF`, `IFERROR`) must not use [`flatten_args`]: it
//! evaluates every argument eagerly.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{ArgValue, EvalContext, EvalError};
use calc_core::value::{Value, parse_number_text};

/// Evaluate every argument and flatten into `(value, range_derived)`
/// pairs, preserving left-to-right order (floating-point accumulation
/// order must match, see `docs/functions/SUM.md`).
///
/// Eager: every argument is evaluated, including ones whose value will be
/// ignored. Suitable for the aggregating functions only.
pub fn flatten_args(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Result<Vec<(Value, bool)>, EvalError> {
    let mut out = Vec::new();
    for arg in args {
        match ctx.eval_arg(arg)? {
            ArgValue::Scalar(v) => out.push((v, false)),
            ArgValue::Ref(v) => out.push((v, true)),
            ArgValue::Range(a) => out.extend(a.into_iter().map(|v| (v, true))),
        }
    }
    Ok(out)
}

/// Numbers per the SUM-family rule: scalars coerce via
/// [`Value::to_number`] (errors and `#VALUE!` propagate), range-derived
/// members contribute only `Value::Number`s; error cells propagate.
pub fn collect_numbers(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Result<Result<Vec<f64>, CalcError>, EvalError> {
    let flat = flatten_args(ctx, args)?;
    let mut out = Vec::new();
    for (v, ranged) in flat {
        if ranged {
            match v {
                Value::Number(n) => out.push(n),
                Value::Error(e) => return Ok(Err(e)),
                _ => {}
            }
        } else {
            match v.to_number() {
                Ok(n) => out.push(n),
                Err(e) => return Ok(Err(e)),
            }
        }
    }
    Ok(Ok(out))
}

/// Booleans per the AND/OR rule: scalars coerce via
/// [`Value::to_boolean`]; range-derived members use only numbers and
/// booleans (text and blanks ignored). Error values propagate either way.
/// Returns `Err(CalcError::Value)` when no usable logicals remain.
pub fn collect_booleans(
    ctx: &mut EvalContext<'_>,
    args: &[Expr],
) -> Result<Result<Vec<bool>, CalcError>, EvalError> {
    let flat = flatten_args(ctx, args)?;
    let mut out = Vec::new();
    for (v, ranged) in flat {
        if let Some(e) = v.error() {
            return Ok(Err(e));
        }
        if ranged {
            match v {
                Value::Number(n) => out.push(n != 0.0),
                Value::Boolean(b) => out.push(b),
                _ => {}
            }
        } else {
            match v.to_boolean() {
                Ok(b) => out.push(b),
                Err(e) => return Ok(Err(e)),
            }
        }
    }
    if out.is_empty() {
        return Ok(Err(CalcError::Value));
    }
    Ok(Ok(out))
}

/// Whether a scalar text value parses as a number (COUNT's direct-arg
/// rule: `"5"` counts, `"x"` does not and does not error).
pub fn text_is_number(s: &str) -> bool {
    parse_number_text(s).is_some()
}

#[cfg(test)]
pub(crate) mod test_support {
    use calc_core::CalcEngine;
    use calc_core::value::Value;
    use calc_core::workbook::CellInput;

    /// Evaluate `formula` on `Sheet1` after storing `inputs` as values,
    /// using the standard function registry.
    pub fn eval_with(inputs: &[(&str, Value)], formula: &str) -> Value {
        let mut e = CalcEngine::new();
        e.set_registry(Box::new(crate::registry::default_registry()));
        e.add_sheet("Sheet1").unwrap();
        for (addr, v) in inputs {
            e.set_cell("Sheet1", addr, CellInput::Value(v.clone()))
                .unwrap();
        }
        e.eval_formula("Sheet1", formula).unwrap()
    }

    /// Evaluate `formula` with no inputs.
    pub fn eval(formula: &str) -> Value {
        eval_with(&[], formula)
    }
}
