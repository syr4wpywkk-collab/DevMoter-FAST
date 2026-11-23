//! Distribution numerics (v3 foundation, track F1): the special
//! functions the ~130 v3 statistical functions build on — log-gamma,
//! the regularized incomplete gamma and beta functions, `erf`/`erfc`,
//! the normal CDF and its inverse, a generic monotone-CDF inverter,
//! and log-space PMF helpers.
//!
//! Everything here is pure `f64` std math — no external crates — and
//! returns `f64`, using `NaN` for inputs outside the mathematical
//! domain (non-positive shape parameters, probabilities outside
//! `[0, 1]`, `x < 0` for the incomplete functions). Callers map `NaN`
//! to `#NUM!`; this module never produces `CalcError`.
//!
//! Accuracy targets (all relative to the true value unless noted):
//! - `ln_gamma`: ~1e-15 (Lanczos, g = 7, N = 9 — the Numerical
//!   Recipes coefficients).
//! - `regularized_gamma_p` / `regularized_gamma_q`: ~1e-13 central,
//!   ~1e-9 far tails (series + continued fraction, NR `gser`/`gcf`).
//! - `regularized_beta`: ~1e-13 (continued fraction, NR `betai`).
//! - `erf` / `erfc` / `normal_cdf`: ~1e-15, derived from the
//!   incomplete-gamma kernels.
//! - `normal_inv`: Acklam's rational approximation plus one Halley
//!   refinement step — ~1e-15 absolute over `(0, 1)`.
//! - `inverse_cdf`: guaranteed `tol` on the bracket width.

const SQRT_2: f64 = std::f64::consts::SQRT_2;
const SQRT_2PI: f64 = 2.50662827463100050241576528481104525;
const F64_EPS: f64 = f64::EPSILON;

/// Lanczos coefficients for g = 7, n = 9 (Numerical Recipes, 3rd ed.
/// §6.1). Gives |rel err| ≲ 2e-15 for Re(x) > 0.
const LANCZOS: [f64; 9] = [
    0.999_999_999_999_809_9,
    676.520_368_121_885_1,
    -1_259.139_216_722_402_8,
    771.323_428_777_653_1,
    -176.615_029_162_140_6,
    12.507_343_278_686_905,
    -0.138_571_095_265_720_12,
    9.984_369_578_019_572e-6,
    1.505_632_735_149_311_6e-7,
];

/// Natural logarithm of the gamma function, `ln Γ(x)` for `x > 0`.
///
/// Lanczos approximation (g = 7, n = 9); relative error ≲ 2e-15 over
/// the positive axis. Returns `NaN` for `x <= 0` — Excel's `GAMMALN`
/// errors there even where `Γ(x) > 0` mathematically, and the
/// incomplete-function kernels below never need the negative axis.
///
/// See `docs/functions/GAMMALN.md`.
pub fn ln_gamma(x: f64) -> f64 {
    if x.is_nan() || x <= 0.0 {
        // Covers NaN, 0, negatives, and -inf uniformly.
        return f64::NAN;
    }
    // Reflection is unnecessary: use the approximation directly. For
    // tiny x the Lanczos series still holds but the shift x -> x+7
    // loses precision; ln Γ(x) = ln Γ(x+1) - ln(x) is exact in log
    // space and keeps the series argument ≥ 1.
    if x < 0.5 {
        return ln_gamma(x + 1.0) - x.ln();
    }
    let mut a = LANCZOS[0];
    for (i, &c) in LANCZOS.iter().enumerate().skip(1) {
        a += c / (x + i as f64 - 1.0);
    }
    let t = x + 6.5; // g - 0.5
    const LN_SQRT_2PI: f64 = 0.918_938_533_204_672_7;
    LN_SQRT_2PI + (x - 0.5) * t.ln() - t + a.ln()
}

/// Gamma function `Γ(x)`.
///
/// `exp(ln_gamma(x))` for `x > 0`; reflection
/// `Γ(x) = π / (Γ(1-x) · sin πx)` for `x < 0`. Returns `NaN` at the
/// non-positive integers (poles) and for `NaN` input, `+inf` on
/// overflow, and `±0` on underflow — matching `f64` semantics.
pub fn gamma(x: f64) -> f64 {
    if x.is_nan() {
        return f64::NAN;
    }
    if x > 0.0 {
        return ln_gamma(x).exp();
    }
    if x == x.floor() {
        // Pole at 0, -1, -2, ...
        return f64::NAN;
    }
    if x < -170.0 {
        // |Γ| underflows to 0 well before this; sign flips each
        // integer strip. Return signed zero.
        return if (-x).floor() as i64 % 2 == 0 {
            -0.0
        } else {
            0.0
        };
    }
    std::f64::consts::PI / (gamma(1.0 - x) * (std::f64::consts::PI * x).sin())
}

/// Regularized lower incomplete gamma `P(a, x) = γ(a,x)/Γ(a)`.
///
/// Series expansion for `x < a + 1`, continued-fraction complement
/// otherwise (Numerical Recipes `gser`/`gcf`). Domain: `a > 0`,
/// `x >= 0`; `x = 0` gives 0. Returns `NaN` outside the domain.
/// Relative error ≲ 1e-13 in the central region.
pub fn regularized_gamma_p(a: f64, x: f64) -> f64 {
    if a.is_nan() || x.is_nan() || a <= 0.0 || x < 0.0 {
        return f64::NAN;
    }
    if x == 0.0 {
        return 0.0;
    }
    if x == f64::INFINITY {
        return 1.0;
    }
    if x < a + 1.0 {
        gamma_series_p(a, x)
    } else {
        // Q may legitimately underflow to 0 in the far right tail.
        1.0 - gamma_cf_q(a, x)
    }
}

/// Regularized upper incomplete gamma `Q(a, x) = Γ(a,x)/Γ(a) = 1 - P`.
///
/// Continued fraction for `x >= a + 1`, series complement otherwise.
/// Same domain and accuracy as [`regularized_gamma_p`]; prefer this
/// when the right tail is the quantity of interest.
pub fn regularized_gamma_q(a: f64, x: f64) -> f64 {
    if a.is_nan() || x.is_nan() || a <= 0.0 || x < 0.0 {
        return f64::NAN;
    }
    if x == 0.0 {
        return 1.0;
    }
    if x == f64::INFINITY {
        return 0.0;
    }
    if x < a + 1.0 {
        1.0 - gamma_series_p(a, x)
    } else {
        gamma_cf_q(a, x)
    }
}

/// NR `gser`: `P(a,x)` via the series
/// `e^{-x} x^a Σ Δ` with `Δ_{n+1} = Δ_n · x/(a+n)`.
fn gamma_series_p(a: f64, x: f64) -> f64 {
    let gln = ln_gamma(a);
    let mut sum = 1.0 / a;
    let mut delta = sum;
    for n in 1..=1000 {
        delta *= x / (a + n as f64);
        sum += delta;
        if delta.abs() <= sum.abs() * F64_EPS {
            break;
        }
    }
    sum * (-x + a * x.ln() - gln).exp()
}

/// NR `gcf`: `Q(a,x)` via the modified Lentz continued fraction.
fn gamma_cf_q(a: f64, x: f64) -> f64 {
    const FPMIN: f64 = f64::MIN_POSITIVE / F64_EPS;
    let gln = ln_gamma(a);
    let mut b = x + 1.0 - a;
    let mut c = 1.0 / FPMIN;
    let mut d = 1.0 / b.max(FPMIN);
    let mut h = d;
    for i in 1..=1000 {
        let i = i as f64;
        let an = -i * (i - a);
        b += 2.0;
        d = (an * d + b).max(FPMIN);
        c = (an / c + b).max(FPMIN);
        d = 1.0 / d;
        let delta = d * c;
        h *= delta;
        if (delta - 1.0).abs() <= F64_EPS {
            break;
        }
    }
    h * (-x + a * x.ln() - gln).exp()
}

/// Regularized incomplete beta `I_x(a, b)`.
///
/// Continued fraction evaluated directly or by symmetry
/// (`I_x(a,b) = 1 - I_{1-x}(b,a)`) so the fraction always runs on the
/// fast-converging side (Numerical Recipes `betai`). Domain:
/// `a > 0`, `b > 0`, `0 <= x <= 1`; the endpoints give 0 and 1.
/// Returns `NaN` outside the domain. Relative error ≲ 1e-13.
pub fn regularized_beta(x: f64, a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() || x.is_nan() || a <= 0.0 || b <= 0.0 || !(0.0..=1.0).contains(&x) {
        return f64::NAN;
    }
    if x == 0.0 {
        return 0.0;
    }
    if x == 1.0 {
        return 1.0;
    }
    // Front factor x^a (1-x)^b / B(a,b); underflows to a true 0
    // only for extreme parameters, where the CDF is genuinely ~0/1.
    let front =
        (a * x.ln() + b * (1.0 - x).ln() + ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b)).exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        front / a * beta_cf(x, a, b)
    } else {
        1.0 - front / b * beta_cf(1.0 - x, b, a)
    }
}

/// NR `betacf`: modified Lentz continued fraction for the incomplete
/// beta kernel.
fn beta_cf(x: f64, a: f64, b: f64) -> f64 {
    const FPMIN: f64 = f64::MIN_POSITIVE / F64_EPS;
    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < FPMIN {
        d = FPMIN;
    }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..=1000 {
        let m = m as f64;
        let m2 = 2.0 * m;
        let mut aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        h *= d * c;
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < FPMIN {
            d = FPMIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < FPMIN {
            c = FPMIN;
        }
        d = 1.0 / d;
        let delta = d * c;
        h *= delta;
        if (delta - 1.0).abs() <= F64_EPS {
            break;
        }
    }
    h
}

/// Error function `erf(x)`.
///
/// Computed as `sign(x) · P(1/2, x²)` — the `a = 1/2` incomplete
/// gamma identity — which carries the kernels' ~1e-15 relative
/// accuracy and needs no separate rational approximation to maintain.
/// `erf(±0) = ±0`, `erf(±∞) = ±1`, `erf(NaN) = NaN`.
///
/// See `docs/functions/ERF.md`.
pub fn erf(x: f64) -> f64 {
    if x.is_nan() {
        return f64::NAN;
    }
    if x == 0.0 {
        return x; // preserves -0
    }
    let p = regularized_gamma_p(0.5, x * x);
    x.signum() * p
}

/// Complementary error function `erfc(x) = 1 - erf(x)`.
///
/// `sign`-symmetric form of `Q(1/2, x²)`; computing it directly keeps
/// full precision in the right tail where `1 - erf(x)` would cancel
/// (`erfc(27)` ≈ 5e-158 is still representable).
pub fn erfc(x: f64) -> f64 {
    if x.is_nan() {
        return f64::NAN;
    }
    if x >= 0.0 {
        regularized_gamma_q(0.5, x * x)
    } else {
        2.0 - regularized_gamma_q(0.5, x * x)
    }
}

/// Standard normal CDF `Φ(x) = ½ erfc(-x/√2)`.
///
/// The `erfc` form avoids cancellation for large negative `x`
/// (`Φ(-38)` ≈ 5e-315 vs `1 + erf` collapsing to 0 early).
/// `Φ(±∞) = 1/0` respectively, `Φ(NaN) = NaN`.
pub fn normal_cdf(x: f64) -> f64 {
    0.5 * erfc(-x / SQRT_2)
}

/// Inverse standard normal CDF `Φ⁻¹(p)` — Acklam's rational
/// approximation (max |rel err| ~1e-9) followed by one Halley step,
/// which brings the result to full double precision (~1e-15) over the
/// whole open interval.
///
/// Returns `-inf`/`+inf` at `p = 0`/`1` (Excel's `NORM.S.INV` agrees:
/// it returns `±inf`-scale numbers rather than `#NUM!` — flagged
/// SPEC-OPEN in `docs/functions/NORM.S.INV.md`) and `NaN` outside
/// `[0, 1]`.
///
/// See `docs/functions/NORM.S.INV.md`.
pub fn normal_inv(p: f64) -> f64 {
    // Acklam coefficients.
    const A: [f64; 6] = [
        -3.969_683_028_665_376e1,
        2.209_460_984_245_205e2,
        -2.759_285_104_469_687e2,
        1.383_577_518_672_69e2,
        -3.066_479_806_614_716e1,
        2.506_628_277_459_239e0,
    ];
    const B: [f64; 5] = [
        -5.447_609_879_822_406e1,
        1.615_858_368_580_409e2,
        -1.556_989_798_598_866e2,
        6.680_131_188_771_972e1,
        -1.328_068_155_288_572e1,
    ];
    const C: [f64; 6] = [
        -7.784_894_002_430_293e-3,
        -3.223_964_580_411_365e-1,
        -2.400_758_277_161_838e0,
        -2.549_732_539_343_734e0,
        4.374_664_141_464_968e0,
        2.938_163_982_698_783e0,
    ];
    const D: [f64; 5] = [
        7.784_695_709_041_462e-3,
        3.224_671_290_700_398e-1,
        2.445_134_137_142_996e0,
        3.754_408_661_907_416e0,
        0.0, // unused 5th slot keeps shapes symmetric
    ];
    const P_LOW: f64 = 0.024_25;
    const P_HIGH: f64 = 1.0 - P_LOW;

    if p.is_nan() || !(0.0..=1.0).contains(&p) {
        return f64::NAN;
    }
    if p == 0.0 {
        return f64::NEG_INFINITY;
    }
    if p == 1.0 {
        return f64::INFINITY;
    }

    let x = if p < P_LOW {
        // Lower tail: rational in q = sqrt(-2 ln p).
        let q = (-2.0 * p.ln()).sqrt();
        poly(&C, q) / poly4(&D, q)
    } else if p <= P_HIGH {
        // Central: rational in q = p - 0.5.
        let q = p - 0.5;
        let r = q * q;
        poly(&A, r) * q / poly5(&B, r)
    } else {
        let q = (-2.0 * (1.0 - p).ln()).sqrt();
        -poly(&C, q) / poly4(&D, q)
    };

    // One Halley refinement: x - (F-p)/φ · 1/(1 - x(F-p)/(2φ)).
    // Kills the approximation's ~1e-9 residual in a single step.
    let e = normal_cdf(x) - p;
    let u = e * SQRT_2PI * (0.5 * x * x).exp();
    x - u / (1.0 + 0.5 * x * u)
}

/// Acklam numerators list the leading coefficient first:
/// `((((c0 q + c1) q + c2) q + c3) q + c4) q + c5`.
fn poly(c: &[f64; 6], q: f64) -> f64 {
    ((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]
}

/// Acklam denominators fold the trailing `+ 1`:
/// `((((c0 q + c1) q + c2) q + c3) q + c4) q + 1`.
fn poly5(c: &[f64; 5], q: f64) -> f64 {
    ((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + 1.0
}

/// Tail denominator has only 4 coefficients:
/// `(((c0 q + c1) q + c2) q + c3) q + 1` — `D[4]` is a zero pad.
fn poly4(c: &[f64; 5], q: f64) -> f64 {
    (((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + 1.0
}

/// Generic inverse-CDF solver: find `x` in `[lo, hi]` with
/// `cdf(x) = target` for a monotone non-decreasing `cdf`.
///
/// Safeguarded secant (regula falsi with bisection fallback):
/// each step takes a secant iterate and clamps it into the shrinking
/// bracket; convergence is declared when the bracket is tighter than
/// `tol` (absolute) or `cdf` hits `target` exactly. Runs to
/// `max_iter`; a few hundred is far more than needed for smooth CDFs.
///
/// Returns `NaN` when the bracket is invalid (`lo >= hi`, `tol <= 0`)
/// or `target` lies outside `[cdf(lo), cdf(hi)]` — the caller then
/// decides between clamping to the support and `#NUM!`.
pub fn inverse_cdf<F>(cdf: F, target: f64, lo: f64, hi: f64, tol: f64, max_iter: usize) -> f64
where
    F: Fn(f64) -> f64,
{
    if lo.is_nan() || hi.is_nan() || tol.is_nan() || lo >= hi || tol <= 0.0 || max_iter == 0 {
        return f64::NAN;
    }
    let mut a = lo;
    let mut b = hi;
    let mut fa = cdf(a) - target;
    let mut fb = cdf(b) - target;
    if fa.is_nan() || fb.is_nan() || fa > 0.0 || fb < 0.0 {
        // Not bracketed (or the CDF is undefined at an endpoint).
        return f64::NAN;
    }
    if fa == 0.0 {
        return a;
    }
    if fb == 0.0 {
        return b;
    }
    for _ in 0..max_iter {
        // Secant iterate; falls back to the midpoint when the slope
        // degenerates (flat tails, equal residuals).
        let mut x = a - fa * (b - a) / (fb - fa);
        if !(x > a && x < b) {
            x = a + (b - a) / 2.0;
        }
        if b - a <= tol {
            return x;
        }
        let fx = cdf(x) - target;
        if fx.is_nan() {
            return f64::NAN;
        }
        if fx == 0.0 {
            return x;
        }
        if fx < 0.0 {
            a = x;
            fa = fx;
        } else {
            b = x;
            fb = fx;
        }
    }
    // Out of iterations: report the best bracket midpoint.
    a + (b - a) / 2.0
}

/// `ln C(n, k)` — log of the binomial coefficient via `ln_gamma`.
///
/// Works for non-integer `n` (the gamma generalization of `C(n,k)`)
/// and stays finite where `C(n,k)` itself would overflow (`n` > 170).
/// Returns `NaN` for `k < 0`, `k > n`, or `n < 0`.
pub fn ln_choose(n: f64, k: f64) -> f64 {
    if n.is_nan() || k.is_nan() || n < 0.0 || k < 0.0 || k > n {
        return f64::NAN;
    }
    ln_gamma(n + 1.0) - ln_gamma(k + 1.0) - ln_gamma(n - k + 1.0)
}

/// Log of the binomial PMF: `ln P(X = k)` for `X ~ Bin(n, p)`,
/// computed as `ln_choose(n,k) + k ln p + (n-k) ln(1-p)` so the
/// result never underflows in the PMF's far tails.
///
/// Degenerate probabilities follow the distribution's own limits:
/// `p = 0` gives `0` for `k = 0` and `-inf` for `k > 0`; `p = 1`
/// mirrors that. Returns `NaN` for `p` outside `[0, 1]` or invalid
/// `n`/`k` (see [`ln_choose`]).
///
/// See `docs/functions/BINOM.DIST.md`.
pub fn ln_binomial_pmf(k: f64, n: f64, p: f64) -> f64 {
    if !(0.0..=1.0).contains(&p) {
        return f64::NAN;
    }
    let lc = ln_choose(n, k);
    if lc.is_nan() {
        return f64::NAN;
    }
    // Term-by-term limits: k·ln p → 0 when k = 0 even at p = 0, etc.
    let term_p = if k == 0.0 {
        0.0
    } else if p == 0.0 {
        return f64::NEG_INFINITY;
    } else {
        k * p.ln()
    };
    let term_q = if n - k == 0.0 {
        0.0
    } else if p == 1.0 {
        return f64::NEG_INFINITY;
    } else {
        (n - k) * (1.0 - p).ln()
    };
    lc + term_p + term_q
}

/// Log of the Poisson PMF: `ln P(X = k) = k ln λ - λ - ln Γ(k+1)`.
///
/// `λ = 0` is degenerate: `k = 0` gives `0`, `k > 0` gives `-inf`.
/// Returns `NaN` for `λ < 0` or `k < 0`.
///
/// See `docs/functions/POISSON.DIST.md`.
pub fn ln_poisson_pmf(k: f64, lambda: f64) -> f64 {
    if lambda.is_nan() || k.is_nan() || lambda < 0.0 || k < 0.0 {
        return f64::NAN;
    }
    if lambda == 0.0 {
        return if k == 0.0 { 0.0 } else { f64::NEG_INFINITY };
    }
    k * lambda.ln() - lambda - ln_gamma(k + 1.0)
}

// ---------- Bessel functions (v3 engineering, track I11) ----------

// The `BESSEL{I,J,K,Y}` worksheet functions evaluate the four Bessel
// families at *integer order* `n >= 0`. Implementations are the
// Numerical Recipes (3rd ed. §6.5-6.6) kernels: rational fits for the
// order-0/1 functions (split at |x| = 8 for J/Y, |x| = 3.75 for I,
// x = 2 for K), Miller's downward recurrence for J_n (n > x) and I_n,
// and upward recurrences for J_n (n < x), Y_n and K_n.
//
// Accuracy targets (relative, per NR's fit quality):
// - `bessel_j` / `bessel_y`: ~1e-13 near unit order, degrading slowly
//   for large `x` near the functions' zeros.
// - `bessel_i` / `bessel_k`: ~1e-7 (Abramowitz & Stegun polynomial
//   fits). Excel's own Bessel results are no more precise; spec
//   tolerances in `docs/functions/BESSEL*.md` sit at ~1e-6.
//
// Domain errors return `NaN` (callers map to `#NUM!`); `n < 0` is
// rejected by the caller before dispatch. Non-finite overflow (I_n for
// large `x`, K_n near `x -> 0+`) propagates as `inf`/`NaN` and the
// caller maps that to `#NUM!` as well.

/// J_n(x) for integer `n >= 0`, any real `x`.
pub fn bessel_j(n: i64, x: f64) -> f64 {
    if n < 0 || x.is_nan() {
        return f64::NAN;
    }
    if n == 0 {
        return bessel_j0(x);
    }
    if n == 1 {
        return bessel_j1(x);
    }
    if x == 0.0 {
        return 0.0;
    }
    let ax = x.abs();
    let nf = n as f64;
    if ax > nf {
        // Upward recurrence is stable for n < x.
        let tox = 2.0 / ax;
        let mut bjm = bessel_j0(ax);
        let mut bj = bessel_j1(ax);
        for k in 1..n {
            let bjp = k as f64 * tox * bj - bjm;
            bjm = bj;
            bj = bjp;
        }
        if x < 0.0 && n % 2 == 1 { -bj } else { bj }
    } else {
        // Miller's algorithm: downward recurrence normalized by the
        // known J_0 sum.
        let tox = 2.0 / ax;
        let m = 2 * ((n + (40.0 * nf).sqrt() as i64) / 2);
        let mut bj = 1.0;
        let mut bjp = 0.0;
        let mut ans = 0.0;
        let mut sum = 0.0;
        let mut take = false;
        for j in (1..=m).rev() {
            let bjm = j as f64 * tox * bj - bjp;
            bjp = bj;
            bj = bjm;
            if bj.abs() > 1e10 {
                bj *= 1e-10;
                bjp *= 1e-10;
                ans *= 1e-10;
                sum *= 1e-10;
            }
            if take {
                sum += bj;
            }
            take = !take;
            if j == n {
                ans = bjp;
            }
        }
        sum = 2.0 * sum - bj;
        ans /= sum;
        if x < 0.0 && n % 2 == 1 { -ans } else { ans }
    }
}

/// Y_n(x) for integer `n >= 0`, `x > 0`. Returns `NaN` for `x <= 0`.
pub fn bessel_y(n: i64, x: f64) -> f64 {
    if n < 0 || x.is_nan() || x <= 0.0 {
        return f64::NAN;
    }
    if n == 0 {
        return bessel_y0(x);
    }
    if n == 1 {
        return bessel_y1(x);
    }
    // Upward recurrence is always stable for Y.
    let tox = 2.0 / x;
    let mut bym = bessel_y0(x);
    let mut by = bessel_y1(x);
    for k in 1..n {
        let byp = k as f64 * tox * by - bym;
        bym = by;
        by = byp;
    }
    by
}

/// I_n(x) for integer `n >= 0`, any real `x`. Overflow returns `inf`.
pub fn bessel_i(n: i64, x: f64) -> f64 {
    if n < 0 || x.is_nan() {
        return f64::NAN;
    }
    if n == 0 {
        return bessel_i0(x);
    }
    if n == 1 {
        return bessel_i1(x);
    }
    if x == 0.0 {
        return 0.0;
    }
    let ax = x.abs();
    let i0 = bessel_i0(ax);
    if !i0.is_finite() {
        return f64::INFINITY;
    }
    // Downward recurrence normalized by I_0.
    let tox = 2.0 / ax;
    let nf = n as f64;
    let m = 2 * (n + (40.0 * nf).sqrt() as i64);
    let mut bi = 1.0;
    let mut bip = 0.0;
    let mut ans = 0.0;
    for j in (1..=m).rev() {
        let bim = bip + j as f64 * tox * bi;
        bip = bi;
        bi = bim;
        if bi.abs() > 1e10 {
            bi *= 1e-10;
            bip *= 1e-10;
            ans *= 1e-10;
        }
        if j == n {
            ans = bip;
        }
    }
    ans *= i0 / bi;
    if x < 0.0 && n % 2 == 1 { -ans } else { ans }
}

/// K_n(x) for integer `n >= 0`, `x > 0`. Returns `NaN` for `x <= 0`.
pub fn bessel_k(n: i64, x: f64) -> f64 {
    if n < 0 || x.is_nan() || x <= 0.0 {
        return f64::NAN;
    }
    if n == 0 {
        return bessel_k0(x);
    }
    if n == 1 {
        return bessel_k1(x);
    }
    // Upward recurrence is always stable for K.
    let tox = 2.0 / x;
    let mut bkm = bessel_k0(x);
    let mut bk = bessel_k1(x);
    for k in 1..n {
        let bkp = bkm + k as f64 * tox * bk;
        bkm = bk;
        bk = bkp;
    }
    bk
}

/// J_0(x): rational fit for |x| < 8, asymptotic form beyond (NR bessj0).
fn bessel_j0(x: f64) -> f64 {
    let ax = x.abs();
    if ax < 8.0 {
        let y = x * x;
        let num = 57568490574.0
            + y * (-13362590354.0
                + y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * (-184.9052456)))));
        let den = 57568490411.0
            + y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y))));
        num / den
    } else {
        let z = 8.0 / ax;
        let y = z * z;
        let xx = ax - 0.785398164;
        let p = 1.0
            + y * (-0.1098628627e-2
                + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
        let q = -0.1562499995e-1
            + y * (0.1430488765e-3
                + y * (-0.6911147651e-5 + y * (0.7621095161e-6 + y * (-0.934945152e-7))));
        (std::f64::consts::FRAC_2_PI / ax).sqrt() * (xx.cos() * p - z * xx.sin() * q)
    }
}

/// J_1(x): NR bessj1.
fn bessel_j1(x: f64) -> f64 {
    let ax = x.abs();
    let ans = if ax < 8.0 {
        let y = x * x;
        let num = x
            * (72362614232.0
                + y * (-7895059235.0
                    + y * (242396853.1
                        + y * (-2972611.439 + y * (15704.48260 + y * (-30.16036606))))));
        let den = 144725228442.0
            + y * (2300535178.0 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
        num / den
    } else {
        let z = 8.0 / ax;
        let y = z * z;
        let xx = ax - 2.356194491;
        let p = 1.0
            + y * (0.183105e-2
                + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * (-0.240337019e-6))));
        let q = 0.04687499995
            + y * (-0.2002690873e-3
                + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
        (std::f64::consts::FRAC_2_PI / ax).sqrt() * (xx.cos() * p - z * xx.sin() * q)
    };
    if x < 0.0 { -ans } else { ans }
}

/// Y_0(x), `x > 0`: NR bessy0.
fn bessel_y0(x: f64) -> f64 {
    if x < 8.0 {
        let y = x * x;
        let num = -2957821389.0
            + y * (7062834065.0
                + y * (-512359803.6 + y * (10879881.29 + y * (-86327.92757 + y * 228.4622733))));
        let den = 40076544269.0
            + y * (745249964.8 + y * (7189466.438 + y * (47447.26470 + y * (226.1030244 + y))));
        num / den + std::f64::consts::FRAC_2_PI * bessel_j0(x) * x.ln()
    } else {
        let z = 8.0 / x;
        let y = z * z;
        let xx = x - 0.785398164;
        let p = 1.0
            + y * (-0.1098628627e-2
                + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
        let q = -0.1562499995e-1
            + y * (0.1430488765e-3
                + y * (-0.6911147651e-5 + y * (0.7621095161e-6 + y * (-0.934945152e-7))));
        (std::f64::consts::FRAC_2_PI / x).sqrt() * (xx.sin() * p + z * xx.cos() * q)
    }
}

/// Y_1(x), `x > 0`: NR bessy1.
fn bessel_y1(x: f64) -> f64 {
    if x < 8.0 {
        let y = x * x;
        let num = x
            * (-0.4900604943e13
                + y * (0.1275274390e13
                    + y * (-0.5153438139e11
                        + y * (0.7349264551e9 + y * (-0.4237922726e7 + y * 0.8511937935e4)))));
        let den = 0.2499580570e14
            + y * (0.4244419664e12
                + y * (0.3733650367e10
                    + y * (0.2245904002e8 + y * (0.1020426050e6 + y * (0.3549632885e3 + y)))));
        num / den + std::f64::consts::FRAC_2_PI * (bessel_j1(x) * x.ln() - 1.0 / x)
    } else {
        let z = 8.0 / x;
        let y = z * z;
        let xx = x - 2.356194491;
        let p = 1.0
            + y * (0.183105e-2
                + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * (-0.240337019e-6))));
        let q = 0.04687499995
            + y * (-0.2002690873e-3
                + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
        (std::f64::consts::FRAC_2_PI / x).sqrt() * (xx.sin() * p + z * xx.cos() * q)
    }
}

/// I_0(x): NR bessi0 (A&S 9.8.1/9.8.2 polynomial fits, |err| <~ 2e-7).
fn bessel_i0(x: f64) -> f64 {
    let ax = x.abs();
    if ax < 3.75 {
        let y = (x / 3.75) * (x / 3.75);
        1.0 + y
            * (3.5156229
                + y * (3.0899424
                    + y * (1.2067492 + y * (0.2659732 + y * (0.360768e-1 + y * 0.45813e-2)))))
    } else {
        let y = 3.75 / ax;
        (ax.exp() / ax.sqrt())
            * (0.39894228
                + y * (0.1328592e-1
                    + y * (0.225319e-2
                        + y * (-0.157565e-2
                            + y * (0.916281e-2
                                + y * (-0.2057706e-1
                                    + y * (0.2635537e-1
                                        + y * (-0.1647633e-1 + y * 0.392377e-2))))))))
    }
}

/// I_1(x): NR bessi1.
fn bessel_i1(x: f64) -> f64 {
    let ax = x.abs();
    let ans = if ax < 3.75 {
        let y = (x / 3.75) * (x / 3.75);
        ax * (0.5
            + y * (0.87890594
                + y * (0.51498869
                    + y * (0.15084934 + y * (0.2658733e-1 + y * (0.301532e-2 + y * 0.32411e-3))))))
    } else {
        let y = 3.75 / ax;
        (ax.exp() / ax.sqrt())
            * (0.39894228
                + y * (-0.3988024e-1
                    + y * (-0.362018e-2
                        + y * (0.163801e-2
                            + y * (-0.1031555e-1
                                + y * (0.2282967e-1
                                    + y * (-0.2895312e-1
                                        + y * (0.1787654e-1 - y * 0.420059e-2))))))))
    };
    if x < 0.0 { -ans } else { ans }
}

/// K_0(x), `x > 0`: NR bessk0.
fn bessel_k0(x: f64) -> f64 {
    if x <= 2.0 {
        let y = x * x / 4.0;
        (-(x / 2.0).ln()) * bessel_i0(x)
            + (-0.57721566
                + y * (0.42278420
                    + y * (0.23069756
                        + y * (0.3488590e-1 + y * (0.262698e-2 + y * (0.10750e-3 + y * 0.74e-5))))))
    } else {
        let y = 2.0 / x;
        ((-x).exp() / x.sqrt())
            * (1.25331414
                + y * (-0.7832358e-1
                    + y * (0.2189568e-1
                        + y * (-0.1062446e-1
                            + y * (0.587872e-2 + y * (-0.251540e-2 + y * 0.53208e-3))))))
    }
}

/// K_1(x), `x > 0`: NR bessk1.
fn bessel_k1(x: f64) -> f64 {
    if x <= 2.0 {
        let y = x * x / 4.0;
        (x / 2.0).ln() * bessel_i1(x)
            + (1.0 / x)
                * (1.0
                    + y * (0.15443144
                        + y * (-0.67278579
                            + y * (-0.18156897
                                + y * (-0.1919402e-1 + y * (-0.110404e-2 + y * (-0.4686e-4)))))))
    } else {
        let y = 2.0 / x;
        ((-x).exp() / x.sqrt())
            * (1.25331414
                + y * (0.23498619
                    + y * (-0.3655620e-1
                        + y * (0.1504268e-1
                            + y * (-0.780353e-2 + y * (0.325614e-2 + y * (-0.68245e-3)))))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REL_CENTRAL: f64 = 1e-12;
    const REL_TAIL: f64 = 1e-9;

    fn rel_err(got: f64, want: f64) -> f64 {
        ((got - want) / want).abs()
    }

    fn assert_rel(got: f64, want: f64, tol: f64) {
        assert!(
            got.is_finite() && rel_err(got, want) <= tol,
            "got {got:e}, want {want:e} (rel err {:.2e}, tol {tol:e})",
            rel_err(got, want)
        );
    }

    // ---------- ln_gamma / gamma ----------

    #[test]
    fn ln_gamma_known_values() {
        // GAMMALN.md worked examples.
        assert_rel(ln_gamma(4.0), 1.791_759_469_228_055, REL_CENTRAL); // ln 6
        assert_rel(ln_gamma(0.5), 0.572_364_942_924_700_1, REL_CENTRAL); // ln √π
        assert_rel(ln_gamma(10.0), 12.801_827_480_081_469, REL_CENTRAL); // ln 9!
        // ln Γ(1) = ln Γ(2) = 0 (absolute check — no relative anchor).
        assert!(ln_gamma(1.0).abs() < 1e-14);
        assert!(ln_gamma(2.0).abs() < 1e-14);
    }

    #[test]
    fn ln_gamma_factorial_recurrence() {
        // ln Γ(n+1) = ln(n!) for factorials up to 20!.
        let mut ln_fact = 0.0f64;
        for n in 1..=20 {
            ln_fact += (n as f64).ln();
            // Absolute tolerance: ln_fact starts at exactly 0.
            assert!(
                (ln_gamma(n as f64 + 1.0) - ln_fact).abs() < 1e-12,
                "n={n}: ln_gamma {} vs {ln_fact}",
                ln_gamma(n as f64 + 1.0)
            );
        }
    }

    #[test]
    fn ln_gamma_small_and_large() {
        // x < 0.5 goes through the shift branch: ln Γ(0.1) known value.
        assert_rel(ln_gamma(0.1), 2.252_712_651_734_205_5, REL_CENTRAL);
        // Stirling check at large x: Γ(171.5)-ish still finite.
        assert!(ln_gamma(171.0).is_finite());
        assert_rel(ln_gamma(100.0), 359.134_205_369_575_4, REL_TAIL);
    }

    #[test]
    fn ln_gamma_invalid_domain() {
        assert!(ln_gamma(0.0).is_nan());
        assert!(ln_gamma(-1.0).is_nan());
        assert!(ln_gamma(-0.5).is_nan()); // Excel errors here too (SPEC-OPEN noted in GAMMALN.md)
        assert!(ln_gamma(f64::NAN).is_nan());
        assert!(ln_gamma(f64::NEG_INFINITY).is_nan());
    }

    #[test]
    fn gamma_positive() {
        assert_rel(gamma(5.0), 24.0, REL_CENTRAL);
        assert_rel(gamma(0.5), std::f64::consts::PI.sqrt(), REL_CENTRAL);
        assert_rel(gamma(1.5), 0.886_226_925_452_758, REL_CENTRAL);
        assert!(gamma(172.0).is_infinite()); // 171! overflows f64
    }

    #[test]
    fn gamma_reflection_negative() {
        // Γ(-0.5) = -2√π.
        assert_rel(gamma(-0.5), -2.0 * std::f64::consts::PI.sqrt(), REL_TAIL);
        // Γ(-1.5) = 4√π/3.
        assert_rel(
            gamma(-1.5),
            4.0 * std::f64::consts::PI.sqrt() / 3.0,
            REL_TAIL,
        );
        // Poles.
        assert!(gamma(0.0).is_nan());
        assert!(gamma(-2.0).is_nan());
        assert!(gamma(f64::NAN).is_nan());
    }

    // ---------- regularized gamma ----------

    #[test]
    fn gamma_p_series_region() {
        // GAMMA.DIST(4,2,2,TRUE): P(2,2) = 1 - 3e^-2.
        assert_rel(
            regularized_gamma_p(2.0, 2.0),
            0.593_994_150_290_161_9,
            REL_CENTRAL,
        );
        // CHISQ.DIST(0.5,1): P(0.5,0.25) = erf(sqrt(0.25)) = erf(0.5).
        assert_rel(
            regularized_gamma_p(0.5, 0.25),
            0.520_499_877_813_046_5,
            REL_CENTRAL,
        );
        // CHISQ.DIST(18.307,10) ≈ 0.95: P(5, 9.1535).
        assert_rel(regularized_gamma_p(5.0, 9.153_5), 0.950_000_03, 1e-6);
    }

    #[test]
    fn gamma_q_cf_region() {
        // Q(2, 4) = e^-4 (1+4) = 5e^-4 (x >= a+1 branch).
        assert_rel(
            regularized_gamma_q(2.0, 4.0),
            5.0 * (-4.0f64).exp(),
            REL_CENTRAL,
        );
        // Integer closed form: Q(2, x) = e^-x (1 + x).
        assert_rel(
            regularized_gamma_q(2.0, 9.210_34),
            (-9.210_34f64).exp() * 10.210_34,
            REL_CENTRAL,
        );
    }

    #[test]
    fn gamma_p_q_complement() {
        for (a, x) in [
            (0.5, 0.1),
            (1.0, 1.0),
            (3.7, 3.7),
            (10.0, 30.0),
            (0.3, 50.0),
        ] {
            let s = regularized_gamma_p(a, x) + regularized_gamma_q(a, x);
            assert!((s - 1.0).abs() < 1e-13, "a={a} x={x}: P+Q={s}");
        }
    }

    fn fact(k: i32) -> f64 {
        (1..=k).map(|i| i as f64).product::<f64>().max(1.0)
    }

    #[test]
    fn gamma_p_integer_closed_form() {
        // P(n, x) = 1 - e^-x Σ_{k=0}^{n-1} x^k/k! for integer n.
        let x = 3.5f64;
        let sum: f64 = (0..4).map(|k| x.powi(k) / fact(k)).sum();
        assert_rel(
            regularized_gamma_p(4.0, x),
            1.0 - (-x).exp() * sum,
            REL_CENTRAL,
        );
    }

    #[test]
    fn gamma_p_tail_accuracy() {
        // Deep right tail: Q(1, 20) = e^-20 ≈ 2.06e-9.
        assert_rel(regularized_gamma_q(1.0, 20.0), (-20.0f64).exp(), REL_TAIL);
        // Q(5, 40): compare against the stable integer form.
        let x = 40.0f64;
        let sum: f64 = (0..5).map(|k| x.powi(k) / fact(k)).sum();
        assert_rel(regularized_gamma_q(5.0, x), (-x).exp() * sum, REL_TAIL);
    }

    #[test]
    fn gamma_p_domain() {
        assert!(regularized_gamma_p(0.0, 1.0).is_nan());
        assert!(regularized_gamma_p(-1.0, 1.0).is_nan());
        assert!(regularized_gamma_p(1.0, -1.0).is_nan());
        assert_eq!(regularized_gamma_p(1.0, 0.0), 0.0);
        assert_eq!(regularized_gamma_q(1.0, 0.0), 1.0);
        assert!(regularized_gamma_p(f64::NAN, 1.0).is_nan());
        // Huge x: P saturates to 1, Q underflows toward 0.
        assert_eq!(regularized_gamma_p(1.0, 800.0), 1.0);
    }

    // ---------- regularized beta ----------

    #[test]
    fn beta_known_values() {
        // BETA.DIST(0.5,2,3,TRUE) -> 0.6875.
        assert_rel(regularized_beta(0.5, 2.0, 3.0), 0.6875, REL_CENTRAL);
        // F.DIST(1,1,1): I_0.5(0.5,0.5) = 0.5.
        assert_rel(regularized_beta(0.5, 0.5, 0.5), 0.5, REL_CENTRAL);
        // BETA.DIST(2,8,10,TRUE,1,3): I_0.5(8,10) = 89846·2^-17 exactly
        // (integer-form identity; the spec doc's 0.6854705810117458 is
        // a lower-precision print).
        assert_rel(
            regularized_beta(0.5, 8.0, 10.0),
            0.685_470_581_054_687_5,
            REL_CENTRAL,
        );
        // Uniform: I_x(1,1) = x.
        assert_rel(regularized_beta(0.37, 1.0, 1.0), 0.37, REL_CENTRAL);
    }

    #[test]
    fn beta_symmetry() {
        for (x, a, b) in [(0.2, 2.0, 5.0), (0.9, 1.5, 0.7), (0.5, 30.0, 30.0)] {
            let s = regularized_beta(x, a, b) + regularized_beta(1.0 - x, b, a);
            assert!((s - 1.0).abs() < 1e-13, "x={x}: symmetry {s}");
        }
    }

    #[test]
    fn beta_symmetric_point() {
        // I_0.5(a,a) = 0.5 for all a.
        for a in [0.3, 1.0, 7.0, 100.0] {
            assert_rel(regularized_beta(0.5, a, a), 0.5, REL_CENTRAL);
        }
    }

    #[test]
    fn beta_endpoints_and_domain() {
        assert_eq!(regularized_beta(0.0, 2.0, 3.0), 0.0);
        assert_eq!(regularized_beta(1.0, 2.0, 3.0), 1.0);
        assert!(regularized_beta(-0.1, 1.0, 1.0).is_nan());
        assert!(regularized_beta(1.1, 1.0, 1.0).is_nan());
        assert!(regularized_beta(0.5, 0.0, 1.0).is_nan());
        assert!(regularized_beta(0.5, 1.0, -2.0).is_nan());
        assert!(regularized_beta(f64::NAN, 1.0, 1.0).is_nan());
    }

    #[test]
    fn beta_large_params() {
        // Tight concentration: I_0.4(500,500) should be a small
        // positive number, I_0.6 its mirror.
        let lo = regularized_beta(0.4, 500.0, 500.0);
        let hi = regularized_beta(0.6, 500.0, 500.0);
        assert!(lo < 1e-6 && hi > 1.0 - 1e-6, "lo={lo} hi={hi}");
        assert!((lo + (1.0 - hi)).abs() < 1e-9);
    }

    // ---------- erf / erfc ----------

    #[test]
    fn erf_known_values() {
        assert_rel(erf(1.0), 0.842_700_792_949_714_9, REL_CENTRAL);
        assert_rel(erf(0.5), 0.520_499_877_813_046_5, REL_CENTRAL);
        assert_rel(erf(2.0), 0.995_322_265_018_952_7, REL_CENTRAL);
        assert_eq!(erf(0.0), 0.0);
    }

    #[test]
    fn erf_odd_symmetry() {
        for x in [0.1, 1.0, 3.7, 8.0] {
            assert_eq!(erf(-x), -erf(x));
        }
    }

    #[test]
    fn erf_extremes() {
        assert_eq!(erf(f64::INFINITY), 1.0);
        assert_eq!(erf(f64::NEG_INFINITY), -1.0);
        assert!(erf(f64::NAN).is_nan());
        assert_eq!(erf(-0.0).to_bits(), (-0.0f64).to_bits());
        // |x| >= ~6 already saturates at f64 precision.
        assert_eq!(erf(6.0), 1.0);
    }

    #[test]
    fn erfc_known_values_and_tail() {
        assert_rel(erfc(1.0), 0.157_299_207_050_285_13, REL_CENTRAL);
        assert_rel(erfc(0.0), 1.0, REL_CENTRAL);
        // Tail stays precise where 1 - erf would cancel:
        // erfc(5) = 1.537459794428e-12.
        assert_rel(erfc(5.0), 1.537_459_794_428_034_8e-12, REL_TAIL);
        // erfc(10) = 2.0884875838e-45.
        assert_rel(erfc(10.0), 2.088_487_583_762_544_7e-45, REL_TAIL);
        assert_eq!(erfc(f64::INFINITY), 0.0);
    }

    #[test]
    fn erf_erfc_complement() {
        for x in [0.0, 0.3, 1.5, 4.0] {
            assert!((erf(x) + erfc(x) - 1.0).abs() < 1e-15);
        }
    }

    // ---------- normal cdf / inv ----------

    #[test]
    fn normal_cdf_known_values() {
        assert_eq!(normal_cdf(0.0), 0.5);
        assert_rel(normal_cdf(1.96), 0.975_002_104_851_779_5, REL_CENTRAL);
        assert_rel(normal_cdf(1.0), 0.841_344_746_068_542_9, REL_CENTRAL);
        assert_rel(normal_cdf(-1.0), 0.158_655_253_931_457_07, REL_CENTRAL);
        // Tails: Φ(-6) = 9.865876e-10, Φ(3.09) ≈ 0.999.
        assert_rel(normal_cdf(-6.0), 9.865_876_450_376_98e-10, REL_TAIL);
        assert_eq!(normal_cdf(f64::INFINITY), 1.0);
        assert_eq!(normal_cdf(f64::NEG_INFINITY), 0.0);
    }

    #[test]
    fn normal_cdf_symmetry() {
        for x in [0.2, 1.3, 5.0, 30.0] {
            assert!((normal_cdf(x) + normal_cdf(-x) - 1.0).abs() < 1e-16);
        }
    }

    #[test]
    fn normal_inv_known_values() {
        assert_eq!(normal_inv(0.5), 0.0);
        // NORM.S.INV.md worked examples.
        assert_rel(normal_inv(0.975), 1.959_963_984_540_054, 1e-14);
        assert_rel(normal_inv(0.001), -3.090_232_306_167_813, 1e-14);
        assert_rel(normal_inv(0.999), 3.090_232_306_167_813, 1e-14);
        assert_rel(normal_inv(0.908_789), 1.333_334, 1e-5);
    }

    #[test]
    fn normal_inv_endpoints_and_domain() {
        assert_eq!(normal_inv(0.0), f64::NEG_INFINITY);
        assert_eq!(normal_inv(1.0), f64::INFINITY);
        assert!(normal_inv(-1e-10).is_nan());
        assert!(normal_inv(1.0 + 1e-10).is_nan());
        assert!(normal_inv(f64::NAN).is_nan());
    }

    #[test]
    fn normal_inv_roundtrip() {
        // Φ(Φ⁻¹(p)) = p to ~1e-14 across the open interval.
        for p in [
            1e-10,
            0.001,
            0.01,
            0.25,
            0.5,
            0.75,
            0.99,
            0.999,
            1.0 - 1e-10,
        ] {
            let rt = normal_cdf(normal_inv(p));
            assert!(
                (rt - p).abs() < 1e-14,
                "p={p}: roundtrip {rt} (err {:.2e})",
                (rt - p).abs()
            );
        }
    }

    #[test]
    fn normal_inv_symmetry() {
        for p in [0.001, 0.1, 0.3, 0.499_999] {
            assert!((normal_inv(1.0 - p) + normal_inv(p)).abs() < 1e-13);
        }
    }

    // ---------- inverse_cdf ----------

    #[test]
    fn inverse_cdf_inverts_normal() {
        let x = inverse_cdf(normal_cdf, 0.975, -10.0, 10.0, 1e-13, 200);
        assert_rel(x, 1.959_963_984_540_054, 1e-9);
    }

    #[test]
    fn inverse_cdf_inverts_exponential() {
        // F(x) = 1 - e^-λx, λ=2; F⁻¹(0.9) = -ln(0.1)/2.
        let x = inverse_cdf(|x| 1.0 - (-2.0 * x).exp(), 0.9, 0.0, 50.0, 1e-14, 200);
        assert_rel(x, 0.1f64.ln().abs() / 2.0, 1e-12);
    }

    #[test]
    fn inverse_cdf_respects_tol_and_hits_exact() {
        // Bracket tolerance is honored.
        let x = inverse_cdf(|t| t, 0.3, 0.0, 1.0, 1e-6, 100);
        assert!((x - 0.3).abs() <= 1e-6);
        // Exact hit on a step-free CDF endpoint.
        assert_eq!(inverse_cdf(|t| t * t, 1.0, 0.0, 1.0, 1e-12, 50), 1.0);
    }

    #[test]
    fn inverse_cdf_unbracketed_and_bad_args() {
        // Target above the bracket's top value.
        assert!(inverse_cdf(|t| t, 2.0, 0.0, 1.0, 1e-9, 100).is_nan());
        // Reversed/degenerate bracket, non-positive tol, zero budget.
        assert!(inverse_cdf(|t| t, 0.5, 1.0, 0.0, 1e-9, 100).is_nan());
        assert!(inverse_cdf(|t| t, 0.5, 0.5, 0.5, 1e-9, 100).is_nan());
        assert!(inverse_cdf(|t| t, 0.5, 0.0, 1.0, 0.0, 100).is_nan());
        assert!(inverse_cdf(|t| t, 0.5, 0.0, 1.0, 1e-9, 0).is_nan());
        // NaN-producing CDF.
        assert!(inverse_cdf(|_| f64::NAN, 0.5, 0.0, 1.0, 1e-9, 100).is_nan());
    }

    #[test]
    fn inverse_cdf_flat_tail_cdf() {
        // A CDF with a flat region: secant must fall back to bisection
        // without stalling.
        let cdf = |x: f64| (x - 5.0).clamp(0.0, 1.0);
        let x = inverse_cdf(cdf, 0.5, 0.0, 10.0, 1e-10, 500);
        assert!((x - 5.5).abs() < 1e-9);
    }

    // ---------- log-space helpers ----------

    #[test]
    fn ln_choose_values() {
        assert_rel(ln_choose(10.0, 6.0), 210.0f64.ln(), REL_CENTRAL);
        assert!(ln_choose(5.0, 0.0).abs() < 1e-12);
        assert!(ln_choose(5.0, 5.0).abs() < 1e-12);
        // Far beyond direct-factorial range.
        assert!(ln_choose(1000.0, 500.0).is_finite());
        assert!(ln_choose(3.0, 4.0).is_nan());
        assert!(ln_choose(-1.0, 0.0).is_nan());
        assert!(ln_choose(5.0, -1.0).is_nan());
    }

    #[test]
    fn ln_binomial_pmf_values() {
        // BINOM.DIST(6,10,0.5,FALSE) -> 0.205078125.
        assert_rel(
            ln_binomial_pmf(6.0, 10.0, 0.5).exp(),
            0.205_078_125,
            REL_CENTRAL,
        );
        // C(50,30)·0.6^30·0.4^20 = 0.114558552829524.
        assert_rel(
            ln_binomial_pmf(30.0, 50.0, 0.6).exp(),
            0.114_558_552_829_524,
            REL_CENTRAL,
        );
    }

    #[test]
    fn ln_binomial_pmf_degenerate_p() {
        assert!(ln_binomial_pmf(0.0, 10.0, 0.0).abs() < 1e-12);
        assert_eq!(ln_binomial_pmf(3.0, 10.0, 0.0), f64::NEG_INFINITY);
        assert!(ln_binomial_pmf(10.0, 10.0, 1.0).abs() < 1e-12);
        assert_eq!(ln_binomial_pmf(9.0, 10.0, 1.0), f64::NEG_INFINITY);
        assert!(ln_binomial_pmf(1.0, 10.0, -0.1).is_nan());
        assert!(ln_binomial_pmf(1.0, 10.0, 1.1).is_nan());
        assert!(ln_binomial_pmf(11.0, 10.0, 0.5).is_nan());
    }

    #[test]
    fn ln_poisson_pmf_values() {
        // POISSON.DIST(2,5,FALSE) -> 0.084224337.
        assert_rel(ln_poisson_pmf(2.0, 5.0).exp(), 0.084_224_337, 1e-7);
        // POISSON.DIST(0,1,FALSE) -> e^-1.
        assert_rel(ln_poisson_pmf(0.0, 1.0).exp(), (-1.0f64).exp(), REL_CENTRAL);
        // Degenerate λ=0.
        assert_eq!(ln_poisson_pmf(0.0, 0.0), 0.0);
        assert_eq!(ln_poisson_pmf(2.0, 0.0), f64::NEG_INFINITY);
        assert!(ln_poisson_pmf(1.0, -1.0).is_nan());
        // Tail stays finite in log space where the PMF underflows.
        let lp = ln_poisson_pmf(500.0, 3.0);
        assert!(lp.is_finite() && lp < -500.0);
    }
}
