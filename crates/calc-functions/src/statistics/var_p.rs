//! `VAR.P(number1, [number2], ...)` — population variance
//! (denominator n). Spec: `docs/functions/VAR.P.md`.

use crate::common::coercion;
use crate::common::statistics;
use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::{MAX_ARGS, check_arity};
use calc_core::value::Value;

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, MAX_ARGS) {
        return Ok(Value::Error(e));
    }
    let nums = match coercion::collect_numbers(ctx, args)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(nums) => nums,
    };
    match statistics::population_variance(&nums) {
        Some(v) => Ok(Value::Number(v)),
        None => Ok(Value::Error(CalcError::DivZero)),
    }
}

#[cfg(test)]
mod tests {
    use crate::common::coercion::test_support::*;
    use calc_core::{CalcError, Value};

    fn n(v: &Value) -> f64 {
        match v {
            Value::Number(n) => *n,
            o => panic!("expected number, got {o:?}"),
        }
    }

    fn e(v: &Value) -> CalcError {
        match v {
            Value::Error(e) => *e,
            o => panic!("expected error, got {o:?}"),
        }
    }

    #[test]
    fn basic_population_variance() {
        // Excel VAR.P(1,2,3) = 2/3.
        let v = n(&eval("=VAR.P(1,2,3)"));
        assert!((v - 2.0 / 3.0).abs() < 1e-12, "got {v}");
    }

    #[test]
    fn excel_doc_example() {
        // {1345;1301;1368;1322;1310;1370;1318;1350;1303;1299} -> 678.84.
        let v = n(&eval(
            "=VAR.P(1345,1301,1368,1322,1310,1370,1318,1350,1303,1299)",
        ));
        assert!((v - 678.84).abs() < 0.005, "got {v}");
    }

    #[test]
    fn single_value_gives_zero() {
        assert_eq!(n(&eval("=VAR.P(5)")), 0.0);
    }

    #[test]
    fn all_equal_gives_zero() {
        assert_eq!(n(&eval("=VAR.P(4,4,4)")), 0.0);
    }

    #[test]
    fn no_numeric_values_div_zero() {
        let v = eval_with(&[("A1", "x".into()), ("A2", "y".into())], "=VAR.P(A1:A3)");
        assert_eq!(e(&v), CalcError::DivZero);
    }

    #[test]
    fn range_ignores_text_bool_blank() {
        let v = eval_with(
            &[
                ("A1", 1.0.into()),
                ("A2", "x".into()),
                ("A3", Value::Boolean(true)),
                ("A4", 3.0.into()),
            ],
            "=VAR.P(A1:A5)",
        );
        assert_eq!(n(&v), 1.0);
    }

    #[test]
    fn direct_numeric_text_coerces() {
        assert_eq!(n(&eval(r#"=VAR.P("1",3)"#)), 1.0);
    }

    #[test]
    fn direct_bad_text_value_error() {
        assert_eq!(e(&eval(r#"=VAR.P("abc",3)"#)), CalcError::Value);
    }

    #[test]
    fn direct_boolean_coerces() {
        assert_eq!(n(&eval("=VAR.P(TRUE,3)")), 1.0);
    }

    #[test]
    fn error_cell_propagates() {
        let v = eval_with(
            &[("A1", Value::Error(CalcError::NA)), ("A2", 1.0.into())],
            "=VAR.P(A1:A3)",
        );
        assert_eq!(e(&v), CalcError::NA);
    }

    #[test]
    fn error_in_argument_propagates() {
        assert_eq!(e(&eval("=VAR.P(1/0,2)")), CalcError::DivZero);
    }

    #[test]
    fn matches_stdev_p_squared() {
        let var = n(&eval("=VAR.P(1,2,3,4,5)"));
        let sd = n(&eval("=STDEV.P(1,2,3,4,5)"));
        assert!((var - sd * sd).abs() < 1e-12);
    }
}
