//! Complex-number support for the `IM*` engineering functions (v3).
//!
//! Excel has no complex value type: `COMPLEX` produces canonical text
//! (`"3+4i"`) and every `IM*` function parses that text back. This module
//! is the single owner of both directions plus the arithmetic — function
//! files must not re-implement the format locally.
//!
//! Specs: `docs/functions/COMPLEX.md`, `docs/functions/IMAGINARY.md`
//! ("Complex number format"), and the `IM*` family.

use calc_core::error::CalcError;
use calc_core::value::{Value, format_number, parse_number_text};

/// Failure modes a caller maps onto worksheet errors.
///
/// Mapping per the spec docs (`docs/functions/IM*.md`):
/// - `Parse` -> `#NUM!` for `IM*` functions. (`COMPLEX` maps its own bad
///   `suffix` argument to `#VALUE!`; that check lives in the function.)
/// - `Num` -> `#NUM!` (undefined at the input, e.g. `ln(0)`, or the
///   result overflowed `f64`).
/// - `DivZero` -> the spec is inconsistent: `IMARGUMENT` documents
///   `#DIV/0!` while `IMDIV`/`IMCSC`/`IMCOT`/`IMSEC`/`IMSECH`/`IMCSCH`
///   document `#NUM!` (**SPEC-OPEN** in several files). Returning a
///   distinct variant keeps that choice at the call site.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComplexError {
    /// Text is not a valid complex number.
    Parse,
    /// Operation undefined at this input, or the result is non-finite.
    Num,
    /// Operation requires a nonzero operand but got `0+0i`.
    DivZero,
}

/// Complex number with `f64` components.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Complex {
    pub re: f64,
    pub im: f64,
}

impl Complex {
    pub const ZERO: Complex = Complex { re: 0.0, im: 0.0 };
    pub const ONE: Complex = Complex { re: 1.0, im: 0.0 };
    pub const I: Complex = Complex { re: 0.0, im: 1.0 };

    pub fn new(re: f64, im: f64) -> Complex {
        Complex { re, im }
    }

    /// `re + 0i`.
    pub fn real(re: f64) -> Complex {
        Complex { re, im: 0.0 }
    }

    /// `0 + im·i`.
    pub fn imaginary(im: f64) -> Complex {
        Complex { re: 0.0, im }
    }

    pub fn is_zero(self) -> bool {
        self.re == 0.0 && self.im == 0.0
    }

    pub fn is_finite(self) -> bool {
        self.re.is_finite() && self.im.is_finite()
    }

    /// `Err(Num)` when either component is non-finite — the shared
    /// `#NUM!` overflow check for results of `exp`/`sinh`/… (`IM*` docs:
    /// overflow -> `#NUM!`, never inf/NaN text).
    pub fn require_finite(self) -> Result<Complex, ComplexError> {
        if self.is_finite() {
            Ok(self)
        } else {
            Err(ComplexError::Num)
        }
    }

    /// Real scalar multiplication.
    pub fn scale(self, k: f64) -> Complex {
        Complex::new(self.re * k, self.im * k)
    }

    /// `(a+bi)/(c+di)`, using Smith's algorithm so intermediate `c²+d²`
    /// does not overflow for large divisors (same overflow concern as
    /// `IMABS`, see `docs/functions/IMABS.md` "Engine requirements").
    ///
    /// `Err(DivZero)` when `rhs` is exactly `0+0i`.
    pub fn checked_div(self, rhs: Complex) -> Result<Complex, ComplexError> {
        if rhs.is_zero() {
            return Err(ComplexError::DivZero);
        }
        let out = if rhs.re.abs() >= rhs.im.abs() {
            let r = rhs.im / rhs.re;
            let d = rhs.re + rhs.im * r;
            Complex::new((self.re + self.im * r) / d, (self.im - self.re * r) / d)
        } else {
            let r = rhs.re / rhs.im;
            let d = rhs.re * r + rhs.im;
            Complex::new((self.re * r + self.im) / d, (self.im * r - self.re) / d)
        };
        Ok(out)
    }

    /// Conjugate `x − yi` (`IMCONJUGATE`).
    pub fn conj(self) -> Complex {
        Complex::new(self.re, -self.im)
    }

    /// Modulus `|z| = hypot(re, im)` (`IMABS`); `hypot` avoids the
    /// `sqrt(re²+im²)` overflow noted in the spec.
    pub fn abs(self) -> f64 {
        self.re.hypot(self.im)
    }

    /// Principal argument `atan2(im, re)` in `(−π, π]` (`IMARGUMENT`).
    /// `Err(DivZero)` at the origin — `IMARGUMENT(0)` documents `#DIV/0!`.
    pub fn arg(self) -> Result<f64, ComplexError> {
        if self.is_zero() {
            Err(ComplexError::DivZero)
        } else {
            Ok(self.im.atan2(self.re))
        }
    }

    /// `e^z = e^re·(cos im + i·sin im)` (`IMEXP`).
    pub fn exp(self) -> Complex {
        let r = self.re.exp();
        Complex::new(r * self.im.cos(), r * self.im.sin())
    }

    /// Principal natural logarithm `ln|z| + i·arg(z)` (`IMLN`, `IMLOG2`,
    /// `IMLOG10` share this kernel). `Err(Num)` at `0` per spec; negative
    /// reals are legal (`ln(-1) = πi` on the principal branch).
    pub fn ln(self) -> Result<Complex, ComplexError> {
        if self.is_zero() {
            return Err(ComplexError::Num);
        }
        Ok(Complex::new(self.abs().ln(), self.im.atan2(self.re)))
    }

    /// Principal square root: `sqrt(r)·e^(iθ/2)`, `θ ∈ (−π, π]`
    /// (`IMSQRT`). The result lies in the closed right half-plane;
    /// `sqrt(-4) = 2i` (**SPEC-OPEN** in the spec: sign on the negative
    /// real axis, principal branch gives `+`).
    pub fn sqrt(self) -> Complex {
        if self.is_zero() {
            return Complex::ZERO;
        }
        let r = self.abs().sqrt();
        let half = self.im.atan2(self.re) / 2.0;
        Complex::new(r * half.cos(), r * half.sin())
    }

    /// `z^n` for a real exponent via polar form `r^n·e^(inθ)`
    /// (`IMPOWER`; multi-valued roots resolve to the principal value).
    ///
    /// `0^n`: `n > 0` -> `0`; `n <= 0` -> `Err(Num)` (spec lists
    /// `#NUM!`/`#DIV/0!` as **SPEC-OPEN** — `Num` chosen so the caller
    /// can emit `#NUM!`).
    pub fn pow_real(self, n: f64) -> Result<Complex, ComplexError> {
        if self.is_zero() {
            return if n > 0.0 {
                Ok(Complex::ZERO)
            } else {
                Err(ComplexError::Num)
            };
        }
        let r = self.abs().powf(n);
        let theta = n * self.im.atan2(self.re);
        Ok(Complex::new(r * theta.cos(), r * theta.sin()))
    }

    /// `z^w = exp(w·ln z)` for a complex exponent (MS docs allow a
    /// complex `number` argument to `IMPOWER` — flagged **SPEC-OPEN**).
    /// `Err(Num)` when `z = 0`.
    pub fn pow_complex(self, w: Complex) -> Result<Complex, ComplexError> {
        Ok((w * self.ln()?).exp())
    }

    /// `sin(x+yi) = sin x·cosh y + i·cos x·sinh y` (`IMSIN`).
    pub fn sin(self) -> Complex {
        Complex::new(
            self.re.sin() * self.im.cosh(),
            self.re.cos() * self.im.sinh(),
        )
    }

    /// `cos(x+yi) = cos x·cosh y − i·sin x·sinh y` (`IMCOS`).
    pub fn cos(self) -> Complex {
        Complex::new(
            self.re.cos() * self.im.cosh(),
            -self.re.sin() * self.im.sinh(),
        )
    }

    /// `tan z = sin z / cos z` (`IMTAN`). `Err(DivZero)` at the poles
    /// `re = π/2 + kπ, im = 0` — Excel's behavior there is **SPEC-OPEN**
    /// (error vs huge magnitude); the caller decides.
    pub fn tan(self) -> Result<Complex, ComplexError> {
        self.sin().checked_div(self.cos())
    }

    /// `sinh(x+yi) = sinh x·cos y + i·cosh x·sin y` (`IMSINH`).
    pub fn sinh(self) -> Complex {
        Complex::new(
            self.re.sinh() * self.im.cos(),
            self.re.cosh() * self.im.sin(),
        )
    }

    /// `cosh(x+yi) = cosh x·cos y + i·sinh x·sin y` (`IMCOSH`).
    pub fn cosh(self) -> Complex {
        Complex::new(
            self.re.cosh() * self.im.cos(),
            self.re.sinh() * self.im.sin(),
        )
    }

    /// `tanh z = sinh z / cosh z`.
    pub fn tanh(self) -> Result<Complex, ComplexError> {
        self.sinh().checked_div(self.cosh())
    }

    /// `sec z = 1 / cos z` (`IMSEC`); `Err(DivZero)` where `cos z = 0`.
    pub fn sec(self) -> Result<Complex, ComplexError> {
        Complex::ONE.checked_div(self.cos())
    }

    /// `csc z = 1 / sin z` (`IMCSC`); `Err(DivZero)` where `sin z = 0`.
    pub fn csc(self) -> Result<Complex, ComplexError> {
        Complex::ONE.checked_div(self.sin())
    }

    /// `cot z = cos z / sin z` (`IMCOT`); `Err(DivZero)` at `z = 0`.
    pub fn cot(self) -> Result<Complex, ComplexError> {
        self.cos().checked_div(self.sin())
    }

    /// `sech z = 1 / cosh z` (`IMSECH`).
    pub fn sech(self) -> Result<Complex, ComplexError> {
        Complex::ONE.checked_div(self.cosh())
    }

    /// `csch z = 1 / sinh z` (`IMCSCH`); `Err(DivZero)` at `z = 0`.
    pub fn csch(self) -> Result<Complex, ComplexError> {
        Complex::ONE.checked_div(self.sinh())
    }

    /// Parse Excel complex text (`"3+4i"`, `"-2-5j"`, `"4i"`, `"i"`,
    /// `"-j"`, `"3"`). The suffix must be lowercase `i` or `j`
    /// (`IMAGINARY.md`: uppercase is not accepted, flagged "confirm").
    /// `Err(Parse)` on anything else.
    pub fn parse(s: &str) -> Result<Complex, ComplexError> {
        Complex::parse_with_suffix(s).map(|(z, _)| z)
    }

    /// Like [`Complex::parse`] but also reports the suffix letter
    /// (`'i'` or `'j'`; `'i'` for bare reals) so `IMCONJUGATE`-style
    /// functions can preserve it in their output.
    pub fn parse_with_suffix(s: &str) -> Result<(Complex, char), ComplexError> {
        let t = s.trim();
        if t.is_empty() {
            return Err(ComplexError::Parse);
        }
        let suffix = match t.as_bytes()[t.len() - 1] {
            b'i' => 'i',
            b'j' => 'j',
            _ => {
                let re = parse_coeff(t)?;
                return Ok((Complex::real(re), 'i'));
            }
        };
        let body = &t[..t.len() - 1];
        if body.is_empty() {
            return Ok((Complex::I, suffix));
        }
        // Split "a±b" into real/imaginary parts at a sign that is not a
        // leading sign and not an exponent marker ("1e-2+3i").
        let bytes = body.as_bytes();
        let mut split = None;
        for (idx, &c) in bytes.iter().enumerate() {
            if (c == b'+' || c == b'-') && idx > 0 && !matches!(bytes[idx - 1], b'e' | b'E') {
                split = Some(idx);
            }
        }
        match split {
            Some(p) => {
                let re = parse_coeff(&body[..p])?;
                let im = match &body[p..] {
                    "+" => 1.0,
                    "-" => -1.0,
                    rest => parse_coeff(rest)?,
                };
                Ok((Complex::new(re, im), suffix))
            }
            None => {
                let im = match body {
                    "+" => 1.0,
                    "-" => -1.0,
                    _ => parse_coeff(body)?,
                };
                Ok((Complex::imaginary(im), suffix))
            }
        }
    }

    /// Canonical Excel text form (`COMPLEX` output, `IM*` results).
    /// `suffix` is `'i'` or `'j'` — `IMCONJUGATE` preserves the input
    /// letter; other `IM*` functions' suffix choice is **SPEC-OPEN**.
    ///
    /// Rules per `COMPLEX.md`: imaginary part `0` -> bare real
    /// (`"2"`); real part `0` -> bare imaginary (`"4i"`); imaginary
    /// coefficient `±1` is elided (`"3+i"`, `"i"`, `"-i"`); negative
    /// imaginary renders with `-` (`"3-4i"`).
    ///
    /// **SPEC-OPEN**: whether `IM*` results elide `±1` like `COMPLEX`
    /// does — most spec examples elide (`"8+i"`) but `IMEXP.md` shows
    /// `"-1i"`. [`Complex::to_text_full`] covers the non-eliding style.
    pub fn to_text(self, suffix: char) -> String {
        self.format(suffix, true)
    }

    /// Same as [`Complex::to_text`] but never elides an imaginary
    /// coefficient of `±1` (`"3+1i"`, `"1i"`).
    pub fn to_text_full(self, suffix: char) -> String {
        self.format(suffix, false)
    }

    fn format(self, suffix: char, elide_one: bool) -> String {
        let re_zero = self.re == 0.0;
        let im_zero = self.im == 0.0;
        if im_zero {
            return format_number(self.re);
        }
        let im_abs = self.im.abs();
        let coeff = if elide_one && im_abs == 1.0 {
            String::new()
        } else {
            format_number(im_abs)
        };
        if re_zero {
            if self.im < 0.0 {
                format!("-{coeff}{suffix}")
            } else {
                format!("{coeff}{suffix}")
            }
        } else {
            let sign = if self.im < 0.0 { '-' } else { '+' };
            format!("{}{sign}{coeff}{suffix}", format_number(self.re))
        }
    }
}

impl std::ops::Add for Complex {
    type Output = Complex;

    fn add(self, rhs: Complex) -> Complex {
        Complex::new(self.re + rhs.re, self.im + rhs.im)
    }
}

impl std::ops::Sub for Complex {
    type Output = Complex;

    fn sub(self, rhs: Complex) -> Complex {
        Complex::new(self.re - rhs.re, self.im - rhs.im)
    }
}

/// `(a+bi)(c+di) = (ac−bd) + (ad+bc)i`.
impl std::ops::Mul for Complex {
    type Output = Complex;

    fn mul(self, rhs: Complex) -> Complex {
        Complex::new(
            self.re * rhs.re - self.im * rhs.im,
            self.re * rhs.im + self.im * rhs.re,
        )
    }
}

/// The `inumber` scalar-argument coercion shared by every `IM*`
/// function (`docs/functions/IMAGINARY.md` "Complex number format"):
/// `Number` -> `n+0i`, `Text` -> parsed (`#NUM!` on failure),
/// `Boolean` -> `#VALUE!`, `Blank` -> `0+0i` (**SPEC-OPEN**: `0` vs
/// `#NUM!` — `IMAGINARY.md` flags it; `0` matches the `BIN2*`/`DEC2*`
/// blank convention), `Error` propagates, anything else (arrays) ->
/// `#VALUE!`.
pub fn scalar_operand(v: &Value) -> Result<Complex, CalcError> {
    match v {
        Value::Number(n) => Ok(Complex::real(*n)),
        Value::Text(s) => Complex::parse(s).map_err(|_| CalcError::Num),
        Value::Boolean(_) => Err(CalcError::Value),
        Value::Blank => Ok(Complex::ZERO),
        Value::Error(e) => Err(*e),
        _ => Err(CalcError::Value),
    }
}

/// Map a [`ComplexError`] to the worksheet error used by the `IM*`
/// family: `Parse`/`Num`/`DivZero` all -> `#NUM!` per the spec docs
/// (`IMDIV`/`IMCSC`/`IMCOT`/`IMSEC`/`IMSECH`/`IMCSCH` document `#NUM!`;
/// `IMARGUMENT`'s `#DIV/0!` is the exception and is mapped at its own
/// call site).
pub fn im_error(e: ComplexError) -> CalcError {
    match e {
        ComplexError::Parse | ComplexError::Num | ComplexError::DivZero => CalcError::Num,
    }
}

/// Range-member coercion for the variadic `IMSUM`/`IMPRODUCT`
/// aggregators (`docs/functions/IMSUM.md`, `IMPRODUCT.md`): numbers
/// and complex-parseable text count; blanks, booleans and unparseable
/// text are skipped (**SPEC-OPEN** in both specs — "blank cells and
/// non-numeric text cells are ignored", aligned with `SUM` range
/// rules); error cells propagate via `Some(Err(..))`.
pub fn ranged_operand(v: &Value) -> Option<Result<Complex, CalcError>> {
    match v {
        Value::Number(n) => Some(Ok(Complex::real(*n))),
        Value::Text(s) => Complex::parse(s).ok().map(Ok),
        Value::Error(e) => Some(Err(*e)),
        _ => None,
    }
}

/// Parse one coefficient; rejects empty, non-numeric and non-finite
/// text (`1e999`, `"nan"` spellings are already excluded by
/// [`parse_number_text`]). Currency signs and `,` grouping are not
/// part of a complex number's text.
fn parse_coeff(s: &str) -> Result<f64, ComplexError> {
    if s.contains(['$', ',']) {
        return Err(ComplexError::Parse);
    }
    match parse_number_text(s) {
        Some(n) if n.is_finite() => Ok(n),
        _ => Err(ComplexError::Parse),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn z(re: f64, im: f64) -> Complex {
        Complex::new(re, im)
    }

    fn p(s: &str) -> Complex {
        Complex::parse(s).expect(s)
    }

    fn approx(a: Complex, b: Complex) {
        let tol = 1e-12 * b.abs().max(1.0);
        assert!(
            (a.re - b.re).abs() <= tol && (a.im - b.im).abs() <= tol,
            "expected {b:?}, got {a:?}"
        );
    }

    // --- arithmetic -------------------------------------------------

    #[test]
    fn add_sub() {
        approx(p("3+4i") + p("5-3i"), z(8.0, 1.0));
        approx(p("13+4i") - p("5+3i"), z(8.0, 1.0));
        approx(p("1+2i") - p("1+2i"), Complex::ZERO);
    }

    #[test]
    fn rejects_currency_and_grouping() {
        for s in ["3+$4i", "$3", "1,000+2i", "3+1,000i"] {
            assert_eq!(Complex::parse(s), Err(ComplexError::Parse), "{s}");
        }
    }

    #[test]
    fn mul_basic() {
        // IMPRODUCT example: (3+4i)(5-3i) = 27+11i
        approx(p("3+4i") * p("5-3i"), z(27.0, 11.0));
        approx(p("i") * p("i"), z(-1.0, 0.0));
        approx(p("1+2i") * p("30"), z(30.0, 60.0));
    }

    #[test]
    fn div_basic() {
        // IMDIV examples
        approx(p("1+2i").checked_div(p("3+4i")).unwrap(), z(0.44, 0.08));
        approx(
            p("-238+240i").checked_div(p("10+24i")).unwrap(),
            z(5.0, 12.0),
        );
        approx(p("6").checked_div(p("3")).unwrap(), z(2.0, 0.0));
    }

    #[test]
    fn div_by_zero() {
        assert_eq!(
            p("1").checked_div(Complex::ZERO),
            Err(ComplexError::DivZero)
        );
        assert_eq!(p("1+2i").checked_div(p("0i")), Err(ComplexError::DivZero));
    }

    #[test]
    fn div_large_divisor_no_overflow() {
        // c²+d² would overflow f64 for c,d ~ 1e200; Smith's algorithm must not.
        let q = p("1+1i").checked_div(z(1e200, -1e200)).unwrap();
        assert!(q.is_finite());
        approx(q, z(0.0, 1e-200));
    }

    #[test]
    fn conj_abs() {
        approx(p("3+4i").conj(), z(3.0, -4.0));
        approx(p("3-4j").conj(), z(3.0, 4.0));
        assert_eq!(p("5+12i").abs(), 13.0);
        assert_eq!(p("4i").abs(), 4.0);
        assert_eq!(Complex::real(-6.0).abs(), 6.0);
        // hypot-style: no overflow at ~1e200
        assert_eq!(z(1e200, 1e200).abs(), 2f64.sqrt() * 1e200);
    }

    #[test]
    fn arg_quadrants_and_axis() {
        assert_eq!(p("0+1i").arg().unwrap(), std::f64::consts::FRAC_PI_2);
        approx(
            Complex::imaginary(p("3+4i").arg().unwrap()),
            Complex::imaginary(0.9272952180016122),
        );
        // Negative real axis: principal value is +π, not -π.
        assert_eq!(p("-1").arg().unwrap(), std::f64::consts::PI);
        assert_eq!(p("-1-0i").arg().unwrap(), -std::f64::consts::PI);
    }

    #[test]
    fn arg_zero_is_error() {
        assert_eq!(Complex::ZERO.arg(), Err(ComplexError::DivZero));
    }

    #[test]
    fn exp_examples() {
        // IMEXP("1+i") = e·(cos1 + i·sin1)
        approx(p("1+i").exp(), z(1.4686939399158851, 2.2873552871788423));
        approx(p("0").exp(), z(1.0, 0.0));
        // e^(iπ) ≈ -1
        approx(Complex::imaginary(std::f64::consts::PI).exp(), z(-1.0, 0.0));
    }

    #[test]
    fn ln_principal_branch() {
        approx(p("3+4i").ln().unwrap(), z(5f64.ln(), 4f64.atan2(3.0)));
        // Branch cut: negative real -> +πi (IMLN("-1") = "3.14…i").
        approx(p("-1").ln().unwrap(), z(0.0, std::f64::consts::PI));
        approx(p("1").ln().unwrap(), Complex::ZERO);
        assert_eq!(Complex::ZERO.ln(), Err(ComplexError::Num));
    }

    #[test]
    fn sqrt_principal() {
        approx(p("4").sqrt(), z(2.0, 0.0));
        // Negative real axis: principal root is +2i (right half-plane).
        approx(p("-4").sqrt(), z(0.0, 2.0));
        approx(
            p("i").sqrt(),
            z(
                std::f64::consts::FRAC_1_SQRT_2,
                std::f64::consts::FRAC_1_SQRT_2,
            ),
        );
        approx(p("1+i").sqrt(), z(1.0986841134678098, 0.45508986056222733));
    }

    #[test]
    fn pow_real_examples() {
        // IMPOWER("2+3i",3) = -46+9i
        approx(p("2+3i").pow_real(3.0).unwrap(), z(-46.0, 9.0));
        approx(p("2").pow_real(10.0).unwrap(), z(1024.0, 0.0));
        approx(p("4").pow_real(0.5).unwrap(), z(2.0, 0.0));
        // i² = -1 (within float residue)
        approx(p("i").pow_real(2.0).unwrap(), z(-1.0, 0.0));
    }

    #[test]
    fn pow_real_zero_base() {
        approx(Complex::ZERO.pow_real(2.0).unwrap(), Complex::ZERO);
        assert_eq!(Complex::ZERO.pow_real(0.0), Err(ComplexError::Num));
        assert_eq!(Complex::ZERO.pow_real(-1.0), Err(ComplexError::Num));
    }

    #[test]
    fn pow_complex_matches_real_exponent() {
        approx(
            p("2+3i").pow_complex(Complex::real(3.0)).unwrap(),
            z(-46.0, 9.0),
        );
        // i^i = e^(-π/2) (real)
        approx(
            p("i").pow_complex(Complex::I).unwrap(),
            z((-std::f64::consts::FRAC_PI_2).exp(), 0.0),
        );
        assert_eq!(
            Complex::ZERO.pow_complex(Complex::ONE),
            Err(ComplexError::Num)
        );
    }

    #[test]
    fn trig_examples() {
        // IMSIN / IMCOS / IMTAN spec values
        approx(p("1+i").sin(), z(1.2984575814159773, 0.6349639147847361));
        approx(p("1+i").cos(), z(0.8337300251311491, -0.9888977057628651));
        approx(
            p("1+i").tan().unwrap(),
            z(0.27175258531951174, 1.0839233273386946),
        );
        // sin(i) = i·sinh(1); cos(i) = cosh(1); tan(i) = i·tanh(1)
        approx(p("i").sin(), z(0.0, 1f64.sinh()));
        approx(p("i").cos(), z(1f64.cosh(), 0.0));
        approx(p("i").tan().unwrap(), z(0.0, 1f64.tanh()));
        // Near the pole (re = π/2): f64 cos(π/2) ≈ 6e-17, so the result
        // is huge-magnitude rather than an error (matches IMTAN.md's
        // documented expectation, marked SPEC-OPEN there).
        let near_pole = p("1.5707963267948966").tan().unwrap();
        assert!(near_pole.abs() > 1e15);
    }

    #[test]
    fn hyperbolic_examples() {
        // IMSINH / IMCOSH spec values
        approx(p("1+i").sinh(), z(0.6349639147847361, 1.2984575814159773));
        approx(p("1+i").cosh(), z(0.8337300251311491, 0.9888977057628651));
        approx(p("i").sinh(), z(0.0, 1f64.sin()));
        approx(p("i").cosh(), z(1f64.cos(), 0.0));
    }

    #[test]
    fn reciprocal_trig() {
        // IMSEC / IMCSC / IMCOT spec values
        approx(
            p("1+i").sec().unwrap(),
            z(0.4983370305551868, 0.5910838417210451),
        );
        approx(
            p("1+i").csc().unwrap(),
            z(0.6215180171704284, -0.3039310016284264),
        );
        approx(
            p("1+i").cot().unwrap(),
            z(0.21762156185440265, -0.8680141428959249),
        );
        assert_eq!(Complex::ZERO.csc(), Err(ComplexError::DivZero));
        assert_eq!(Complex::ZERO.cot(), Err(ComplexError::DivZero));
    }

    #[test]
    fn reciprocal_hyperbolic() {
        // IMSECH / IMCSCH spec values
        approx(
            p("1+i").sech().unwrap(),
            z(0.4983370305551868, -0.5910838417210451),
        );
        approx(
            p("1+i").csch().unwrap(),
            z(0.3039310016284264, -0.6215180171704284),
        );
        assert_eq!(Complex::ZERO.csch(), Err(ComplexError::DivZero));
    }

    #[test]
    fn overflow_is_num() {
        assert_eq!(
            Complex::real(1e308).exp().require_finite(),
            Err(ComplexError::Num)
        );
        assert_eq!(
            z(1e308, 0.0).sinh().require_finite(),
            Err(ComplexError::Num)
        );
        assert_eq!(
            Complex::real(2.0).exp().require_finite().unwrap().re,
            2f64.exp()
        );
    }

    // --- parsing ----------------------------------------------------

    #[test]
    fn parse_full_forms() {
        approx(p("3+4i"), z(3.0, 4.0));
        approx(p("3-4i"), z(3.0, -4.0));
        approx(p("-2-5j"), z(-2.0, -5.0));
        approx(p("+1.5+2.25i"), z(1.5, 2.25));
    }

    #[test]
    fn parse_pure_forms() {
        approx(p("4i"), z(0.0, 4.0));
        approx(p("-j"), z(0.0, -1.0));
        approx(p("i"), z(0.0, 1.0));
        approx(p("+i"), z(0.0, 1.0));
        approx(p("3"), z(3.0, 0.0));
        approx(p("-2.5"), z(-2.5, 0.0));
    }

    #[test]
    fn parse_elided_and_exponent_coeffs() {
        approx(p("3+i"), z(3.0, 1.0));
        approx(p("3-i"), z(3.0, -1.0));
        approx(p("1e2+3e-1i"), z(100.0, 0.3));
        approx(p("-1E2+4i"), z(-100.0, 4.0));
    }

    #[test]
    fn parse_rejects() {
        for bad in [
            "", " ", "abc", "3+4", "2+ii", "3+4I", "3+4J", "i+i", "3++4i", "4ii", "1e999+1i",
            "3+1e999i",
        ] {
            assert_eq!(Complex::parse(bad), Err(ComplexError::Parse), "{bad:?}");
        }
    }

    #[test]
    fn parse_uppercase_suffix_rejected() {
        // IMAGINARY.md: only lowercase i/j (flagged "confirm").
        assert_eq!(Complex::parse("3+4I"), Err(ComplexError::Parse));
        // ...but a bare real with uppercase suffix is not text->number either
        assert_eq!(Complex::parse("4J"), Err(ComplexError::Parse));
    }

    #[test]
    fn parse_with_suffix_reports_letter() {
        assert_eq!(Complex::parse_with_suffix("3+4j").unwrap().1, 'j');
        assert_eq!(Complex::parse_with_suffix("3+4i").unwrap().1, 'i');
        assert_eq!(Complex::parse_with_suffix("5").unwrap().1, 'i');
    }

    // --- formatting -------------------------------------------------

    #[test]
    fn format_omits_zero_parts() {
        assert_eq!(z(2.0, 0.0).to_text('i'), "2");
        assert_eq!(z(0.0, 4.0).to_text('i'), "4i");
        assert_eq!(z(0.0, -4.0).to_text('j'), "-4j");
        assert_eq!(z(0.0, 0.0).to_text('i'), "0");
    }

    #[test]
    fn format_elides_unit_coefficient() {
        // COMPLEX.md: ±1 imaginary coefficient renders without the digit.
        assert_eq!(z(3.0, 1.0).to_text('i'), "3+i");
        assert_eq!(z(3.0, -1.0).to_text('i'), "3-i");
        assert_eq!(z(0.0, 1.0).to_text('i'), "i");
        assert_eq!(z(0.0, -1.0).to_text('j'), "-j");
        assert_eq!(z(3.0, 1.0).to_text_full('i'), "3+1i");
        assert_eq!(z(0.0, 1.0).to_text_full('i'), "1i");
    }

    #[test]
    fn format_signs() {
        assert_eq!(z(3.0, 4.0).to_text('i'), "3+4i");
        assert_eq!(z(3.0, -4.0).to_text('i'), "3-4i");
        assert_eq!(z(-2.0, -5.0).to_text('j'), "-2-5j");
        assert_eq!(z(-2.0, 5.0).to_text('i'), "-2+5i");
    }

    #[test]
    fn format_uses_number_formatting() {
        // Delegates to Excel-General-style format_number.
        assert_eq!(z(0.44, 0.08).to_text('i'), "0.44+0.08i");
        assert_eq!(z(2.0, 0.0).to_text('j'), "2");
    }

    // --- round-trips ------------------------------------------------

    #[test]
    fn round_trip_parse_format() {
        for s in [
            "3+4i",
            "3-4i",
            "-2-5j",
            "4i",
            "-4j",
            "i",
            "-i",
            "j",
            "3",
            "-2.5",
            "3+i",
            "3-j",
            "0.44+0.08i",
            "1e2+0.3i",
        ] {
            let (z0, suffix) = Complex::parse_with_suffix(s).unwrap();
            let rendered = z0.to_text(suffix);
            let back = Complex::parse(&rendered).unwrap();
            approx(back, z0);
        }
    }

    #[test]
    fn round_trip_arithmetic() {
        // (a+bi) * conjugate = a²+b² (real)
        let c = p("3+4i");
        approx(c * c.conj(), z(25.0, 0.0));
        // exp(ln z) = z on the principal branch
        let w = p("-2+3i");
        approx(w.ln().unwrap().exp(), w);
    }
}
