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

use calc_core::array::ArrayValue;
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
            ArgValue::Scalar(Value::Array(a)) | ArgValue::Ref(Value::Array(a)) => {
                out.extend(a.into_iter().map(|v| (v, true)))
            }
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

/// Evaluate `arg` and coerce the scalar result to text via
/// [`Value::to_text`] (direct-argument rules). A range argument becomes
/// `Value::Array` and therefore `#VALUE!`, matching Excel's implicit
/// intersection failure for scalar-parameter functions.
pub fn eval_text(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<String, CalcError>, EvalError> {
    Ok(ctx.eval(arg)?.to_text())
}

/// Evaluate `arg` and coerce the scalar result to a number via
/// [`Value::to_number`] (direct-argument rules).
pub fn eval_number(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<f64, CalcError>, EvalError> {
    Ok(ctx.eval(arg)?.to_number())
}

/// Evaluate `arg` as an array for the dynamic-array functions: ranges
/// and `Value::Array` results pass through; any other scalar (including
/// a cell ref) wraps into a 1x1 array. Error inputs propagate.
pub fn eval_array(
    ctx: &mut EvalContext<'_>,
    arg: &Expr,
) -> Result<Result<ArrayValue, CalcError>, EvalError> {
    Ok(match ctx.eval_arg(arg)? {
        ArgValue::Range(a) => Ok(a),
        ArgValue::Scalar(Value::Array(a)) | ArgValue::Ref(Value::Array(a)) => Ok(a),
        ArgValue::Scalar(Value::Error(e)) | ArgValue::Ref(Value::Error(e)) => Err(e),
        ArgValue::Scalar(v) | ArgValue::Ref(v) => ArrayValue::new(1, 1, vec![v]),
    })
}

/// Evaluate an optional scalar argument to a number (direct-argument
/// rules). `None`/`Expr::Missing`/`Value::Blank` all yield `default`;
/// coercion failures yield `Err`.
pub fn eval_opt_number(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    default: f64,
) -> Result<Result<f64, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(default)),
        Some(e) => ctx.eval(e)?,
    };
    if v.is_blank() {
        return Ok(Ok(default));
    }
    Ok(v.to_number())
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
