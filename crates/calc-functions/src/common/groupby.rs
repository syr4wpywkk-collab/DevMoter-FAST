//! Shared aggregation engine for `GROUPBY` and `PIVOTBY` (v3):
//! the `function` argument vocabulary (text names plus ETA lambdas),
//! per-group application over a slice of values, and row grouping by
//! composite keys.
//!
//! Aggregation semantics follow the standalone functions' *range*
//! rules: numeric aggregations consume `Value::Number` members only
//! (text/booleans/blanks ignored), error cells propagate, and an
//! empty numeric set is `#DIV/0!` (AVERAGE-style). `CONCAT` /
//! `ARRAYTOTEXT` use standard text coercions. `PERCENTOF` computes
//! `SUM(group)/SUM(all values)` — the grand-total share; the PIVOTBY
//! parent-axis variants are SPEC-OPEN (`PIVOTBY.md`).

use crate::common::statistics;
use calc_core::array::ArrayValue;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::lambda::LambdaValue;
use calc_core::value::Value;
use std::rc::Rc;

/// Label written into total rows/columns (canonical en-US string;
/// Excel localizes it — SPEC-OPEN per GROUPBY.md).
pub const GRAND_TOTAL: &str = "Grand Total";

/// The resolved `function` argument.
pub enum Agg {
    Sum,
    Average,
    Count,
    CountA,
    Max,
    Min,
    Product,
    StdevS,
    StdevP,
    VarS,
    VarP,
    Median,
    ModeSngl,
    Concat,
    ArrayToText,
    PercentOf,
    Lambda(Rc<LambdaValue>),
}

/// Header text generated for a value column under `field_headers` = 2
/// ("no headers, generate"): `<NAME>(field)`. Canonical strings;
/// Excel's generated names are localized (SPEC-OPEN).
pub fn agg_title(agg: &Agg, field: &str) -> String {
    let name = match agg {
        Agg::Sum => "SUM",
        Agg::Average => "AVERAGE",
        Agg::Count => "COUNT",
        Agg::CountA => "COUNTA",
        Agg::Max => "MAX",
        Agg::Min => "MIN",
        Agg::Product => "PRODUCT",
        Agg::StdevS => "STDEV.S",
        Agg::StdevP => "STDEV.P",
        Agg::VarS => "VAR.S",
        Agg::VarP => "VAR.P",
        Agg::Median => "MEDIAN",
        Agg::ModeSngl => "MODE.SNGL",
        Agg::Concat => "CONCAT",
        Agg::ArrayToText => "ARRAYTOTEXT",
        Agg::PercentOf => "PERCENTOF",
        Agg::Lambda(_) => "LAMBDA",
    };
    if field.is_empty() {
        name.to_string()
    } else {
        format!("{name} of {field}")
    }
}

/// Resolve the `function` argument: a text name (case-insensitive) or
/// an ETA lambda (`LAMBDA(x,SUM(x))` — one parameter, receives the
/// group's value vector as a column array). Unknown names -> `#VALUE!`.
pub fn eval_agg(
    ctx: &mut EvalContext<'_>,
    expr: &Expr,
) -> Result<Result<Agg, CalcError>, EvalError> {
    let v = ctx.eval(expr)?;
    match v {
        Value::Error(e) => Ok(Err(e)),
        Value::Lambda(l) => Ok(Ok(Agg::Lambda(l))),
        other => match other.to_text() {
            Err(e) => Ok(Err(e)),
            Ok(name) => Ok(match name.to_ascii_uppercase().as_str() {
                "SUM" => Ok(Agg::Sum),
                "AVERAGE" => Ok(Agg::Average),
                "COUNT" => Ok(Agg::Count),
                "COUNTA" => Ok(Agg::CountA),
                "MAX" => Ok(Agg::Max),
                "MIN" => Ok(Agg::Min),
                "PRODUCT" => Ok(Agg::Product),
                "STDEV.S" | "STDEV_S" | "STDEV" => Ok(Agg::StdevS),
                "STDEV.P" | "STDEVP" => Ok(Agg::StdevP),
                "VAR.S" | "VAR_S" | "VAR" => Ok(Agg::VarS),
                "VAR.P" | "VARP" => Ok(Agg::VarP),
                "MEDIAN" => Ok(Agg::Median),
                "MODE.SNGL" | "MODE" => Ok(Agg::ModeSngl),
                "CONCAT" => Ok(Agg::Concat),
                "ARRAYTOTEXT" => Ok(Agg::ArrayToText),
                "PERCENTOF" => Ok(Agg::PercentOf),
                _ => Err(CalcError::Value),
            }),
        },
    }
}

/// Apply `agg` to `values` (one column's worth for a group).
/// `all_values` is the full filtered column — needed by `PERCENTOF`.
pub fn apply(
    ctx: &mut EvalContext<'_>,
    agg: &Agg,
    values: &[Value],
    all_values: &[Value],
) -> Result<Value, EvalError> {
    if let Agg::Lambda(l) = agg {
        let col = values.to_vec();
        let len = col.len() as u32;
        return match ArrayValue::new(len, 1, col) {
            Ok(a) => ctx.call_lambda(l, vec![Value::Array(a)]),
            Err(e) => Ok(Value::Error(e)),
        };
    }
    Ok(named(agg, values, all_values))
}

/// Non-lambda application; a pure function over the value slice.
fn named(agg: &Agg, values: &[Value], all_values: &[Value]) -> Value {
    for v in values {
        if let Some(e) = v.error() {
            return Value::Error(e);
        }
    }
    let nums: Vec<f64> = values
        .iter()
        .filter_map(|v| match v {
            Value::Number(n) => Some(*n),
            _ => None,
        })
        .collect();
    match agg {
        Agg::Sum => Value::Number(nums.iter().sum()),
        Agg::Average => {
            if nums.is_empty() {
                Value::Error(CalcError::DivZero)
            } else {
                Value::Number(nums.iter().sum::<f64>() / nums.len() as f64)
            }
        }
        Agg::Count => Value::Number(nums.len() as f64),
        Agg::CountA => Value::Number(values.iter().filter(|v| !v.is_blank()).count() as f64),
        Agg::Max => nums
            .iter()
            .copied()
            .reduce(f64::max)
            .map_or(Value::Number(0.0), Value::Number),
        Agg::Min => nums
            .iter()
            .copied()
            .reduce(f64::min)
            .map_or(Value::Number(0.0), Value::Number),
        Agg::Product => Value::Number(nums.iter().product()),
        Agg::StdevS => match statistics::sample_variance(&nums) {
            Some(v) => Value::Number(v.sqrt()),
            None => Value::Error(CalcError::DivZero),
        },
        Agg::StdevP => match statistics::population_variance(&nums) {
            Some(v) => Value::Number(v.sqrt()),
            None => Value::Error(CalcError::DivZero),
        },
        Agg::VarS => match statistics::sample_variance(&nums) {
            Some(v) => Value::Number(v),
            None => Value::Error(CalcError::DivZero),
        },
        Agg::VarP => match statistics::population_variance(&nums) {
            Some(v) => Value::Number(v),
            None => Value::Error(CalcError::DivZero),
        },
        Agg::Median => {
            if nums.is_empty() {
                Value::Error(CalcError::DivZero)
            } else {
                let mut s = nums;
                s.sort_by(f64::total_cmp);
                Value::Number(statistics::sorted_median(&s))
            }
        }
        Agg::ModeSngl => mode_sngl(&nums),
        Agg::Concat | Agg::ArrayToText => {
            let sep = if matches!(agg, Agg::ArrayToText) {
                ", "
            } else {
                ""
            };
            let mut out = String::new();
            for (i, v) in values.iter().filter(|v| !v.is_blank()).enumerate() {
                if i > 0 {
                    out.push_str(sep);
                }
                match v.to_text() {
                    Ok(t) => out.push_str(&t),
                    Err(e) => return Value::Error(e),
                }
            }
            Value::Text(out)
        }
        Agg::PercentOf => {
            let group: f64 = nums.iter().sum();
            let total: f64 = all_values
                .iter()
                .filter_map(|v| match v {
                    Value::Number(n) => Some(*n),
                    _ => None,
                })
                .sum();
            if total == 0.0 {
                Value::Error(CalcError::DivZero)
            } else {
                Value::Number(group / total)
            }
        }
        Agg::Lambda(_) => unreachable!("handled in apply"),
    }
}

/// Most frequent number; ties go to the first-occurring value;
/// no duplicates -> `#N/A` (MODE.SNGL semantics).
fn mode_sngl(nums: &[f64]) -> Value {
    let mut best: Option<(f64, usize)> = None;
    for &n in nums {
        let count = nums.iter().filter(|&&m| m == n).count();
        let better = match best {
            None => count > 1,
            Some((_, c)) => count > c,
        };
        if better {
            best = Some((n, count));
        }
    }
    match best {
        Some((n, _)) => Value::Number(n),
        None => Value::Error(CalcError::NA),
    }
}

/// A row key: the `row_fields` values of one source row.
pub type Key = Vec<Value>;

/// Compare two composite keys element-wise (Excel type order, blanks
/// last — [`crate::common::compare::sort_cmp`]).
pub fn key_cmp(a: &Key, b: &Key) -> std::cmp::Ordering {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| crate::common::compare::sort_cmp(x, y))
        .find(|o| *o != std::cmp::Ordering::Equal)
        .unwrap_or(std::cmp::Ordering::Equal)
}

/// Group row indices by key, groups ordered by ascending key
/// (stable within a group). `keys[i]` is row `i`'s key.
pub fn group_rows(keys: &[Key]) -> Vec<Vec<usize>> {
    let mut order: Vec<usize> = (0..keys.len()).collect();
    order.sort_by(|&i, &j| key_cmp(&keys[i], &keys[j]));
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for i in order {
        match groups.last_mut() {
            Some(g) if key_cmp(&keys[g[0]], &keys[i]) == std::cmp::Ordering::Equal => g.push(i),
            _ => groups.push(vec![i]),
        }
    }
    groups
}

/// Column `c` of `values` restricted to `rows`.
pub fn column_of(values: &ArrayValue, c: u32, rows: &[usize]) -> Vec<Value> {
    rows.iter()
        .map(|&r| values.get(r as u32, c).unwrap().clone())
        .collect()
}

/// Evaluate an optional enum argument (`Expr::Missing`/blank ->
/// `default`); truncates; range checked by the caller.
pub fn opt_int(
    ctx: &mut EvalContext<'_>,
    expr: Option<&Expr>,
    default: i64,
) -> Result<Result<i64, CalcError>, EvalError> {
    let v = match expr {
        Some(Expr::Missing) | None => return Ok(Ok(default)),
        Some(e) => ctx.eval(e)?,
    };
    if v.is_blank() {
        return Ok(Ok(default));
    }
    if let Some(e) = v.error() {
        return Ok(Err(e));
    }
    Ok(v.to_number().map(|n| n.trunc() as i64))
}
