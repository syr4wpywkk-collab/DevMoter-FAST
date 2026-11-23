//! `ERROR.TYPE(error_val)` — returns a number identifying the error
//! type, or `#N/A` when the argument is not an error. The `#N/A`
//! result is a *result*, not a propagated failure. Spec:
//! `docs/functions/ERROR.TYPE.md`.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

fn error_code(e: CalcError) -> Option<f64> {
    Some(match e {
        CalcError::Null => 1.0,
        CalcError::DivZero => 2.0,
        CalcError::Value => 3.0,
        CalcError::Ref => 4.0,
        CalcError::Name => 5.0,
        CalcError::Num => 6.0,
        CalcError::NA => 7.0,
        // SPEC-OPEN: no documented codes for post-2007 errors
        // (`#SPILL!`, `#CALC!`, `#CIRC!`); treated as "not in the
        // table" -> `#N/A`, same as a non-error argument.
        CalcError::Spill | CalcError::Calc | CalcError::Circ => return None,
    })
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 1, 1) {
        return Ok(Value::Error(e));
    }
    let v = ctx.eval_arg(&args[0])?.into_value();
    match v {
        Value::Error(e) => match error_code(e) {
            Some(code) => Ok(Value::Number(code)),
            None => Ok(Value::Error(CalcError::NA)),
        },
        _ => Ok(Value::Error(CalcError::NA)),
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
    fn spec_examples() {
        assert_eq!(n(&eval("=ERROR.TYPE(1/0)")), 2.0);
        assert_eq!(n(&eval("=ERROR.TYPE(NA())")), 7.0);
        assert_eq!(e(&eval("=ERROR.TYPE(5)")), CalcError::NA);
        assert_eq!(n(&eval("=ERROR.TYPE(#REF!)")), 4.0);
    }

    #[test]
    fn full_mapping() {
        for (lit, code) in [
            ("#NULL!", 1.0),
            ("#DIV/0!", 2.0),
            ("#VALUE!", 3.0),
            ("#REF!", 4.0),
            ("#NAME?", 5.0),
            ("#NUM!", 6.0),
            ("#N/A", 7.0),
        ] {
            assert_eq!(n(&eval(&format!("=ERROR.TYPE({lit})"))), code, "{lit}");
        }
    }

    #[test]
    fn non_error_inputs_give_na() {
        assert_eq!(e(&eval("=ERROR.TYPE(0)")), CalcError::NA);
        assert_eq!(e(&eval(r#"=ERROR.TYPE("x")"#)), CalcError::NA);
        assert_eq!(e(&eval("=ERROR.TYPE(TRUE)")), CalcError::NA);
        assert_eq!(e(&eval("=ERROR.TYPE(A1)")), CalcError::NA);
    }

    #[test]
    fn new_errors_give_na() {
        // SPEC-OPEN: undocumented codes for post-2007 errors.
        assert_eq!(e(&eval("=ERROR.TYPE(#SPILL!)")), CalcError::NA);
        assert_eq!(e(&eval("=ERROR.TYPE(#CALC!)")), CalcError::NA);
    }

    #[test]
    fn error_in_cell() {
        let v = eval_with(&[("A1", Value::Error(CalcError::Num))], "=ERROR.TYPE(A1)");
        assert_eq!(n(&v), 6.0);
    }

    #[test]
    fn div_expression() {
        assert_eq!(n(&eval("=ERROR.TYPE(1/0)")), 2.0);
    }

    #[test]
    fn result_is_error_not_failure() {
        // Composes as a "no error" sentinel via ISNA/IF.
        assert_eq!(eval("=IF(ISNA(ERROR.TYPE(5)),0,99)"), Value::Number(0.0));
        assert_eq!(
            eval("=IF(ISNA(ERROR.TYPE(#NUM!)),0,ERROR.TYPE(#NUM!))"),
            Value::Number(6.0)
        );
    }

    #[test]
    fn isna_of_result() {
        assert_eq!(eval("=ISNA(ERROR.TYPE(9))"), Value::Boolean(true));
        assert_eq!(eval("=ISNA(ERROR.TYPE(#N/A))"), Value::Boolean(false));
    }

    #[test]
    fn arity_error() {
        assert_eq!(e(&eval("=ERROR.TYPE()")), CalcError::Value);
        assert_eq!(e(&eval("=ERROR.TYPE(1,2)")), CalcError::Value);
    }
}
