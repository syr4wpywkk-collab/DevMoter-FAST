//! `RATE(nper, pmt, pv, [fv], [type], [guess])` — per-period rate
//! solving the annuity equation by iteration.
//! Spec: `docs/functions/RATE.md`.
//!
//! Solves `pv*(1+r)^n + pmt*(1+r*type)*A(r) + fv = 0` with
//! `A(r) = ((1+r)^n - 1)/r` over `r > -1`: Newton from `guess`,
//! falling back to bisection over an expanding bracket (the same
//! shape as [`finance::solve_rate`]). Non-convergence, `nper <= 0`,
//! or a cash-flow pattern with no sign change is `#NUM!`.
//!
//! SPEC-OPEN: Excel's exact iteration tolerance / cap (~1e-10, ~20
//! iterations per some references) and whether unsolvable sign
//! patterns report `#NUM!` vs `#VALUE!` — `#NUM!` chosen per the
//! spec doc.

use calc_core::ast::Expr;
use calc_core::error::CalcError;
use calc_core::eval::{EvalContext, EvalError};
use calc_core::registry::check_arity;
use calc_core::value::Value;

use super::{arg_num, opt_num};

/// `A(r) = ((1+r)^n - 1)/r` with the `r -> 0` limit `n`.
fn annuity_factor(r: f64, n: f64) -> f64 {
    if r.abs() < 1e-8 {
        n
    } else {
        ((1.0 + r).powf(n) - 1.0) / r
    }
}

/// `d/dr A(r)` with the `r -> 0` limit `n(n-1)/2`.
fn annuity_factor_prime(r: f64, n: f64) -> f64 {
    if r.abs() < 1e-8 {
        n * (n - 1.0) / 2.0
    } else {
        let g = 1.0 + r;
        (n * g.powf(n - 1.0) * r - (g.powf(n) - 1.0)) / (r * r)
    }
}

/// Residual of the annuity equation; `None` when `r <= -1`
/// (outside the discounting domain).
fn f(r: f64, n: f64, pmt: f64, pv: f64, fv: f64, typ: f64) -> Option<f64> {
    if r <= -1.0 || !r.is_finite() {
        return None;
    }
    Some(pv * (1.0 + r).powf(n) + pmt * (1.0 + r * typ) * annuity_factor(r, n) + fv)
}

fn f_prime(r: f64, n: f64, pmt: f64, pv: f64, typ: f64) -> f64 {
    let g = 1.0 + r;
    pv * n * g.powf(n - 1.0)
        + pmt * (typ * annuity_factor(r, n) + (1.0 + r * typ) * annuity_factor_prime(r, n))
}

fn solve(n: f64, pmt: f64, pv: f64, fv: f64, typ: f64, guess: f64) -> Option<f64> {
    // Newton from the guess (clamped into the domain).
    let mut r = if guess.is_finite() { guess } else { 0.1 }.max(-0.999999);
    for _ in 0..50 {
        let fv_r = f(r, n, pmt, pv, fv, typ)?;
        if fv_r.abs() < 1e-12 {
            return Some(r);
        }
        let d = f_prime(r, n, pmt, pv, typ);
        if !d.is_finite() || d == 0.0 {
            break;
        }
        let next = r - fv_r / d;
        if !next.is_finite() || next <= -0.999999 {
            break; // hit the domain wall: defer to bisection
        }
        if (next - r).abs() < 1e-12 * (1.0 + r.abs()) {
            return Some(next);
        }
        r = next;
    }
    // Bisection over an expanding bracket.
    let f_of = |x: f64| f(x, n, pmt, pv, fv, typ);
    let mut lo = -0.9999999;
    let mut hi = guess.max(0.0) + 0.5;
    let mut flo = f_of(lo)?;
    let mut fhi = f_of(hi)?;
    for _ in 0..200 {
        if flo == 0.0 {
            return Some(lo);
        }
        if flo.signum() != fhi.signum() {
            break;
        }
        hi = hi * 2.0 + 0.5;
        if hi > 1e10 {
            return None;
        }
        fhi = f_of(hi)?;
        flo = f_of(lo)?;
    }
    if flo.signum() == fhi.signum() {
        return None;
    }
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        let fm = f_of(mid)?;
        if fm == 0.0 || (hi - lo) < 1e-12 * (1.0 + mid.abs()) {
            return Some(mid);
        }
        if fm.signum() == flo.signum() {
            lo = mid;
            flo = fm;
        } else {
            hi = mid;
        }
    }
    Some(0.5 * (lo + hi))
}

pub fn call(ctx: &mut EvalContext<'_>, args: &[Expr]) -> Result<Value, EvalError> {
    if let Err(e) = check_arity(args, 3, 6) {
        return Ok(Value::Error(e));
    }
    let nper = match arg_num(ctx, args, 0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let pmt = match arg_num(ctx, args, 1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let pv = match arg_num(ctx, args, 2)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let fv = match opt_num(ctx, args, 3, 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let typ = match opt_num(ctx, args, 4, 0.0)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    let guess = match opt_num(ctx, args, 5, 0.1)? {
        Err(e) => return Ok(Value::Error(e)),
        Ok(v) => v,
    };
    if nper <= 0.0 {
        return Ok(Value::Error(CalcError::Num));
    }
    match solve(nper, pmt, pv, fv, typ, guess) {
        Some(r) if r.is_finite() => Ok(Value::Number(r)),
        _ => Ok(Value::Error(CalcError::Num)),
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
    fn spec_car_loan() {
        // RATE(48, -200, 8000) ≈ 0.7701%/mo.
        let got = n(&eval("=RATE(48,-200,8000)"));
        assert!((got - 0.0077015).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn spec_mortgage() {
        // RATE(360, -1199.10, 200000) ≈ 0.5%/mo.
        let got = n(&eval("=RATE(360,-1199.10,200000)"));
        assert!((got - 0.005).abs() < 1e-4, "got {got}");
    }

    #[test]
    fn spec_small() {
        let got = n(&eval("=RATE(10,-100,800)"));
        assert!((got - 0.0428).abs() < 1e-3, "got {got}");
    }

    #[test]
    fn same_sign_flows_num() {
        // pmt and pv same sign, fv = 0: no root.
        assert_eq!(e(&eval("=RATE(10,100,1000)")), CalcError::Num);
    }

    #[test]
    fn nper_zero_num() {
        assert_eq!(e(&eval("=RATE(0,-100,800)")), CalcError::Num);
    }

    #[test]
    fn nper_negative_num() {
        assert_eq!(e(&eval("=RATE(-5,-100,800)")), CalcError::Num);
    }

    #[test]
    fn pmt_zero_analytic() {
        // (-fv/pv)^(1/n) - 1 = (4000/1000)^(1/2) - 1 = 1.
        let got = n(&eval("=RATE(2,0,-1000,4000)"));
        assert!((got - 1.0).abs() < 1e-8, "got {got}");
    }

    #[test]
    fn type_one_beginning() {
        // Solver is exercised via the inverse: RATE should satisfy the
        // annuity identity for type=1.
        let r = n(&eval("=RATE(10,-100,800,0,1)"));
        let a = (1.0f64 + r).powi(10) - 1.0;
        let residual = 800.0 * (1.0 + r).powi(10) + -100.0 * (1.0 + r) * a / r;
        assert!(residual.abs() < 1e-6, "residual {residual}");
    }

    #[test]
    fn guess_selects_start() {
        let got = n(&eval("=RATE(48,-200,8000,0,0,0.05)"));
        assert!((got - 0.0077015).abs() < 1e-5, "got {got}");
    }

    #[test]
    fn negative_rate_root() {
        // Depreciating: RATE(10, 0, -1000, 500) = 0.5^(1/10)-1 < 0.
        let got = n(&eval("=RATE(10,0,-1000,500)"));
        assert!((got - (0.5f64.powf(0.1) - 1.0)).abs() < 1e-8, "got {got}");
    }

    #[test]
    fn non_numeric_value_error() {
        assert_eq!(e(&eval(r#"=RATE("x",-100,800)"#)), CalcError::Value);
    }

    #[test]
    fn error_arg_propagates() {
        let v = eval_with(&[("A1", Value::Error(CalcError::NA))], "=RATE(10,-100,A1)");
        assert_eq!(e(&v), CalcError::NA);
    }
}
