//! ETS (exponential triple smoothing, additive error/trend/season —
//! "AAA") core for the `FORECAST.ETS*` family (v3, track i02).
//!
//! Pipeline per `docs/functions/FORECAST.ETS.md`:
//!
//! 1. [`prepare`]: validate the timeline (strictly positive, constant
//!    step after gap-filling), align `values` to the implied step grid
//!    (`data_completion` = 1 interpolates missing points, 0 fills them
//!    with zero), and report the detected `step`.
//! 2. [`detect_seasonality`]: pick a seasonal period `m` from
//!    autocorrelation local maxima (needs >= 2 full cycles), used when
//!    the caller's `seasonality` argument selects automatic detection.
//! 3. [`fit`]: additive Holt-Winters smoothing; `(alpha, beta, gamma)`
//!    are chosen by a small Nelder-Mead minimization of one-step
//!    in-sample squared error. Excel's optimizer is undocumented, so
//!    numeric equality with Excel cannot be guaranteed — fixture
//!    expectations for the ETS family are marked `specOpen` per the
//!    spec docs.
//! 4. [`Fit::forecast`]: `l_T + h·b_T + s_{T+h}` (h in step units,
//!    possibly fractional).

use calc_core::error::CalcError;

/// The `seasonality` argument of `FORECAST.ETS*`: `0` = no
/// seasonality, omitted/`1` = automatic detection, `N >= 2` = fixed
/// period `N` steps. Negative values are `#NUM!`; non-integers are
/// truncated (Excel's integer-argument convention — SPEC-OPEN whether
/// Excel truncates or rejects them).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Seasonality {
    Auto,
    None,
    Fixed(usize),
}

/// Parse the optional `seasonality` argument value.
pub fn parse_seasonality(v: Option<f64>) -> Result<Seasonality, CalcError> {
    match v {
        None => Ok(Seasonality::Auto),
        Some(s) if s < 0.0 => Err(CalcError::Num),
        Some(s) => {
            let t = s.trunc();
            Ok(match t as usize {
                0 => Seasonality::None,
                1 => Seasonality::Auto,
                m => Seasonality::Fixed(m),
            })
        }
    }
}

impl Seasonality {
    /// Resolve to a step count: `0` means non-seasonal.
    pub fn period(self, y: &[f64]) -> usize {
        match self {
            Seasonality::Auto => detect_seasonality(y),
            Seasonality::None => 0,
            Seasonality::Fixed(m) => m,
        }
    }
}

/// Collapse duplicate (equal and adjacent) timeline points using the
/// `aggregation` code `1..=7` = AVERAGE, COUNT, COUNTA, MAX, MEDIAN,
/// MIN, SUM. Codes outside that range are `#NUM!` (SPEC-OPEN vs
/// `#VALUE!`). Non-adjacent duplicates are left alone — `prepare`
/// rejects them as an irregular step.
pub fn aggregate(
    times: &[f64],
    values: &[f64],
    aggregation: f64,
) -> Result<(Vec<f64>, Vec<f64>), CalcError> {
    let code = aggregation.trunc();
    if !(1.0..=7.0).contains(&code) {
        return Err(CalcError::Num);
    }
    let reduce = |g: &[f64]| -> f64 {
        match code as u8 {
            1 => g.iter().sum::<f64>() / g.len() as f64,
            2 | 3 => g.len() as f64,
            4 => g.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            5 => {
                let mut s = g.to_vec();
                s.sort_by(f64::total_cmp);
                crate::common::statistics::sorted_median(&s)
            }
            6 => g.iter().copied().fold(f64::INFINITY, f64::min),
            _ => g.iter().sum(),
        }
    };
    let mut ts = Vec::with_capacity(times.len());
    let mut vs = Vec::with_capacity(values.len());
    let mut i = 0;
    while i < times.len() {
        let mut j = i + 1;
        while j < times.len() && times[j] == times[i] {
            j += 1;
        }
        ts.push(times[i]);
        vs.push(reduce(&values[i..j]));
        i = j;
    }
    Ok((ts, vs))
}

/// A cleaned series: values on a uniform step grid plus the detected
/// step and the first/last timeline coordinates.
#[derive(Debug)]
pub struct Prepared {
    pub y: Vec<f64>,
    pub step: f64,
    pub last: f64,
}

/// Validate `times`/`values` and expand to the full step grid.
///
/// Errors (per spec): fewer than 3 points or a non-positive/irregular
/// step -> `#NUM!` (Excel's minimum-history behavior is SPEC-OPEN —
/// 3 chosen as the smallest usable ETS history); `data_completion`
/// outside `{0, 1}` -> `#NUM!`.
pub fn prepare(times: &[f64], values: &[f64], data_completion: f64) -> Result<Prepared, CalcError> {
    if data_completion != 0.0 && data_completion != 1.0 {
        return Err(CalcError::Num);
    }
    let n = times.len();
    if n < 3 || values.len() != n {
        return Err(CalcError::Num);
    }
    // Step = smallest positive gap; every other gap must be an integer
    // multiple of it (relative tolerance for date serials).
    let mut step = f64::INFINITY;
    for w in times.windows(2) {
        let d = w[1] - w[0];
        if d <= 0.0 {
            return Err(CalcError::Num);
        }
        step = step.min(d);
    }
    let tol = 1e-7;
    let mut grid: Vec<Option<f64>> = Vec::new();
    let mut slots = Vec::with_capacity(n);
    for (i, &t) in times.iter().enumerate() {
        let pos = (t - times[0]) / step;
        let slot = pos.round();
        if (pos - slot).abs() > tol || slot < 0.0 {
            return Err(CalcError::Num);
        }
        slots.push((slot as usize, values[i]));
    }
    let total = slots.last().unwrap().0 + 1;
    grid.resize(total, None);
    for (slot, v) in slots {
        if grid[slot].is_some() {
            // Duplicate slot after rounding: irregular input.
            return Err(CalcError::Num);
        }
        grid[slot] = Some(v);
    }
    // Fill holes: linear interpolation (default) or zeros.
    let mut y = Vec::with_capacity(total);
    for (i, cell) in grid.iter().enumerate() {
        match cell {
            Some(v) => y.push(*v),
            None => {
                if data_completion == 0.0 {
                    y.push(0.0);
                } else {
                    // Nearest known neighbors bracket the gap.
                    let mut a = i;
                    while a > 0 && grid[a].is_none() {
                        a -= 1;
                    }
                    let mut b = i;
                    while b < total && grid[b].is_none() {
                        b += 1;
                    }
                    y.push(match (grid[a], grid.get(b).copied().flatten()) {
                        (Some(va), Some(vb)) => va + (vb - va) * (i - a) as f64 / (b - a) as f64,
                        (Some(va), None) => va,
                        (None, Some(vb)) => vb,
                        (None, None) => 0.0,
                    });
                }
            }
        }
    }
    Ok(Prepared {
        y,
        step,
        last: *times.last().unwrap(),
    })
}

/// Detected seasonal period in steps (`0` = none).
///
/// Candidate periods are `2..=n/2` (at least two full cycles are
/// required). The winner is the strongest autocorrelation local
/// maximum above `0.5`; a monotone-decreasing correlogram (pure trend)
/// has no local maximum and yields `0`. Excel's detector is
/// undocumented — SPEC-OPEN (see FORECAST.ETS.SEASONALITY.md).
pub fn detect_seasonality(y: &[f64]) -> usize {
    let n = y.len();
    let mean = y.iter().sum::<f64>() / n as f64;
    let var: f64 = y.iter().map(|v| (v - mean) * (v - mean)).sum();
    if var == 0.0 || n < 4 {
        return 0;
    }
    let r = |m: usize| -> f64 {
        // Lag-window autocorrelation: normalizing by the variance of
        // the lagged segment keeps a perfect `m`-periodic series at
        // `r(m) ≈ 1` even for `m = n/2` (a total-variance divisor
        // caps it at `(n - m)/n`).
        let (mut s, mut d) = (0.0, 0.0);
        for t in m..n {
            s += (y[t] - mean) * (y[t - m] - mean);
            d += (y[t - m] - mean) * (y[t - m] - mean);
        }
        if d == 0.0 { 0.0 } else { s / d }
    };
    let mut best = (0usize, 0.5f64);
    for m in 2..=(n / 2) {
        let rm = r(m);
        if rm > best.1 && rm >= r(m - 1) && (m + 1 > n / 2 || rm >= r(m + 1)) {
            best = (m, rm);
        }
    }
    best.0
}

/// Fitted additive Holt-Winters model plus accuracy statistics.
#[derive(Debug)]
pub struct Fit {
    pub alpha: f64,
    pub beta: f64,
    pub gamma: f64,
    /// Seasonal period in steps; `0` = non-seasonal (ETS A,A,N).
    pub m: usize,
    pub level: f64,
    pub trend: f64,
    /// Seasonal indices for the last full cycle (empty when `m == 0`).
    pub seasonal: Vec<f64>,
    pub mae: f64,
    pub rmse: f64,
    pub smape: f64,
    pub mase: f64,
    /// Forecast-equation residuals over the fit window.
    pub residuals: Vec<f64>,
}

impl Fit {
    /// Point forecast `h` steps (possibly fractional) past the end of
    /// the fit window.
    pub fn forecast(&self, h: f64) -> f64 {
        let mut f = self.level + h * self.trend;
        if self.m > 0 {
            // Seasonal phase of the target horizon within the last cycle.
            let idx = (h.ceil() as usize - 1) % self.m;
            f += self.seasonal[idx];
        }
        f
    }
}

/// One-step SSE for `(alpha, beta, gamma)`; also returns residuals and
/// final state. Out-of-range parameters get an infinite SSE so the
/// optimizer stays inside `[0, 1]³`.
fn simulate(
    y: &[f64],
    m: usize,
    alpha: f64,
    beta: f64,
    gamma: f64,
) -> (f64, Vec<f64>, f64, f64, Vec<f64>) {
    if !(0.0..=1.0).contains(&alpha)
        || !(0.0..=1.0).contains(&beta)
        || !(0.0..=1.0).contains(&gamma)
    {
        return (f64::INFINITY, Vec::new(), 0.0, 0.0, Vec::new());
    }
    let n = y.len();
    // Initial state: level = mean of the first cycle (or first value),
    // trend = per-step drift between the first two cycles (or overall
    // drift when a second cycle does not exist).
    let (mut level, mut trend, mut seas) = if m > 0 {
        let l0 = y[..m].iter().sum::<f64>() / m as f64;
        let t0 = if n >= 2 * m {
            (y[m..2 * m].iter().sum::<f64>() / m as f64 - l0) / m as f64
        } else {
            (y[n - 1] - y[0]) / (n - 1) as f64
        };
        let s: Vec<f64> = y[..m].iter().map(|v| v - l0).collect();
        (l0, t0, s)
    } else {
        (y[0], (y[n - 1] - y[0]) / (n - 1) as f64, Vec::new())
    };
    let start = if m > 0 { m } else { 1 };
    let mut sse = 0.0;
    let mut residuals = Vec::with_capacity(n - start);
    for t in start..n {
        let pred = if m > 0 {
            level + trend + seas[t % m]
        } else {
            level + trend
        };
        let e = y[t] - pred;
        sse += e * e;
        residuals.push(e);
        if m > 0 {
            let s_old = seas[t % m];
            level += trend + alpha * e;
            trend += beta * e;
            seas[t % m] = s_old + gamma * e;
        } else {
            level += trend + alpha * e;
            trend += beta * e;
        }
    }
    (sse, residuals, level, trend, seas)
}

/// Nelder-Mead minimize `f` over `k` parameters starting from `x0`
/// (unit `0.1` initial simplex, 400 iterations, ftol 1e-12). Plain
/// implementation: the parameter space is tiny and smooth.
fn nelder_mead<F: Fn(&[f64]) -> f64>(f: F, x0: &[f64]) -> Vec<f64> {
    let k = x0.len();
    let mut simplex: Vec<Vec<f64>> = vec![x0.to_vec()];
    for i in 0..k {
        let mut p = x0.to_vec();
        p[i] += 0.1;
        simplex.push(p);
    }
    let mut vals: Vec<f64> = simplex.iter().map(|p| f(p)).collect();
    for _ in 0..400 {
        let mut order: Vec<usize> = (0..=k).collect();
        order.sort_by(|&a, &b| vals[a].total_cmp(&vals[b]));
        simplex = order.iter().map(|&i| simplex[i].clone()).collect();
        vals = order.iter().map(|&i| vals[i]).collect();
        if (vals[k] - vals[0]).abs() < 1e-12 {
            break;
        }
        let centroid: Vec<f64> = (0..k)
            .map(|j| simplex[..k].iter().map(|p| p[j]).sum::<f64>() / k as f64)
            .collect();
        let mut reflect: Vec<f64> = (0..k)
            .map(|j| centroid[j] + (centroid[j] - simplex[k][j]))
            .collect();
        let fr = f(&reflect);
        if fr < vals[0] {
            let expand: Vec<f64> = (0..k)
                .map(|j| centroid[j] + 2.0 * (reflect[j] - centroid[j]))
                .collect();
            let fe = f(&expand);
            if fe < fr {
                reflect = expand;
            }
            simplex[k] = reflect;
            vals[k] = f(&simplex[k]);
            continue;
        }
        if fr < vals[k - 1] {
            simplex[k] = reflect;
            vals[k] = fr;
            continue;
        }
        // Contract toward the better of reflect/worst.
        let contract: Vec<f64> = (0..k)
            .map(|j| centroid[j] + 0.5 * (simplex[k][j] - centroid[j]))
            .collect();
        let fc = f(&contract);
        if fc < vals[k] {
            simplex[k] = contract;
            vals[k] = fc;
            continue;
        }
        // Shrink all but the best toward the best.
        for i in 1..=k {
            for j in 0..k {
                simplex[i][j] = simplex[0][j] + 0.5 * (simplex[i][j] - simplex[0][j]);
            }
            vals[i] = f(&simplex[i]);
        }
    }
    let mut order: Vec<usize> = (0..=k).collect();
    order.sort_by(|&a, &b| vals[a].total_cmp(&vals[b]));
    simplex[order[0]].clone()
}

/// Fit ETS(A,A,A) (`m > 0`) or ETS(A,A,N) (`m == 0`) to `y` by
/// Nelder-Mead on the one-step SSE. Also computes the accuracy
/// statistics `FORECAST.ETS.STAT` reports.
pub fn fit(y: &[f64], m: usize) -> Fit {
    let n = y.len();
    let start: Vec<f64> = if m > 0 {
        vec![0.3, 0.05, 0.1]
    } else {
        vec![0.3, 0.05]
    };
    let params = nelder_mead(
        |p| {
            let (alpha, beta, gamma) = if m > 0 {
                (p[0], p[1], p[2])
            } else {
                (p[0], p[1], 0.0)
            };
            simulate(y, m, alpha, beta, gamma).0
        },
        &start,
    );
    let (alpha, beta, gamma) = if m > 0 {
        (params[0], params[1], params[2])
    } else {
        (params[0], params[1], 0.0)
    };
    let (_, residuals, level, trend, seasonal) = simulate(y, m, alpha, beta, gamma);
    let cnt = residuals.len().max(1) as f64;
    let mae = residuals.iter().map(|e| e.abs()).sum::<f64>() / cnt;
    let rmse = (residuals.iter().map(|e| e * e).sum::<f64>() / cnt).sqrt();
    // Accuracy stats use fitted vs actual over the residual window.
    let start_idx = if m > 0 { m } else { 1 };
    let smape = {
        let mut s = 0.0;
        for (i, &e) in residuals.iter().enumerate() {
            let actual = y[start_idx + i];
            let fitted = actual - e;
            let d = (actual.abs() + fitted.abs()) / 2.0;
            s += if d == 0.0 { 0.0 } else { e.abs() / d };
        }
        s / cnt
    };
    let naive: f64 = (1..n).map(|t| (y[t] - y[t - 1]).abs()).sum::<f64>() / (n - 1) as f64;
    let mase = if naive == 0.0 { 0.0 } else { mae / naive };
    Fit {
        alpha,
        beta,
        gamma,
        m,
        level,
        trend,
        seasonal,
        mae,
        rmse,
        smape,
        mase,
        residuals,
    }
}
