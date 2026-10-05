/**
 * Numeric solvers: root-finding, integration and differentiation.
 *
 * Root-finding and numeric calculus are in scope; symbolic algebra is not.
 * These work on a function the sheet defines, by sampling
 * it — which is what an engineer means by "solve for the depth" or "integrate
 * the pressure".
 *
 * The numerics are here, separate from the evaluator, so they can be tested
 * against functions with known answers rather than only through a worksheet.
 * The caller supplies `f` as a plain number-to-number function in coherent SI;
 * dimensions are handled by the evaluator around it, because that is where
 * quantities live.
 */

import { CalcError, type Span } from "./errors.js";

/** A sampled function, in coherent SI on both sides. */
export type Sampled = (x: number) => number;

/**
 * Iteration limits.
 *
 * Generous enough that a well-posed problem never reaches them, and finite so
 * that an ill-posed one reports rather than hangs. A calc sheet recomputes on
 * every keystroke; an unbounded loop there is not a slow answer, it is a dead
 * application.
 */
const MAX_ROOT_STEPS = 200;
const MAX_QUAD_DEPTH = 50;

/**
 * A root of `f` between `a` and `b`, by Brent's method.
 *
 * Brent rather than plain bisection: it keeps bisection's guarantee — the
 * bracket only ever shrinks, so it cannot run away — while using inverse
 * quadratic interpolation where that converges faster. For the smooth
 * functions a calc sheet holds, that is usually a handful of steps.
 *
 * The bracket must already contain a sign change. Searching for one would mean
 * guessing at a scale the function does not advertise, and silently returning
 * the wrong root of several is worse than saying so.
 */
export function findRoot(f: Sampled, a: number, b: number, span: Span): number {
  let lo = a;
  let hi = b;
  let flo = f(lo);
  let fhi = f(hi);

  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) {
    throw new CalcError("domain", "the function has no value at one end of the range", span);
  }
  if (flo > 0 === fhi > 0) {
    throw new CalcError(
      "domain",
      "the function has the same sign at both ends of the range",
      span,
      "a root can only be found between values that straddle it",
    );
  }

  // `c` is the previous contrapoint, `d` the step before last: Brent needs
  // both to decide whether interpolation is behaving.
  let c = lo;
  let fc = flo;
  let d = hi - lo;
  let e = d;

  for (let step = 0; step < MAX_ROOT_STEPS; step += 1) {
    if (fhi > 0 === fc > 0) {
      c = lo;
      fc = flo;
      d = hi - lo;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fhi)) {
      lo = hi;
      hi = c;
      c = lo;
      flo = fhi;
      fhi = fc;
      fc = flo;
    }

    // Tolerance scaled to the value, with a floor: a root near 1e6 cannot be
    // located to 1e-12, and a root near zero should not need to be.
    const tol = 2 * Number.EPSILON * Math.abs(hi) + 1e-12;
    const half = (c - hi) / 2;
    if (Math.abs(half) <= tol || fhi === 0) return hi;

    if (Math.abs(e) >= tol && Math.abs(flo) > Math.abs(fhi)) {
      const s = fhi / flo;
      let p: number;
      let q: number;
      if (lo === c) {
        // Secant.
        p = 2 * half * s;
        q = 1 - s;
      } else {
        // Inverse quadratic.
        const r = fhi / fc;
        const t = flo / fc;
        p = s * (2 * half * t * (t - r) - (hi - lo) * (r - 1));
        q = (t - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      const accept = 2 * p < Math.min(3 * half * q - Math.abs(tol * q), Math.abs(e * q));
      if (accept) {
        e = d;
        d = p / q;
      } else {
        // Interpolation misbehaved; fall back to bisection, which always works.
        d = half;
        e = d;
      }
    } else {
      d = half;
      e = d;
    }

    lo = hi;
    flo = fhi;
    hi += Math.abs(d) > tol ? d : half > 0 ? tol : -tol;
    fhi = f(hi);
    if (!Number.isFinite(fhi)) {
      throw new CalcError("domain", "the function has no value inside the range", span);
    }
  }

  throw new CalcError(
    "domain",
    "no root was found in the range",
    span,
    `stopped after ${MAX_ROOT_STEPS} steps`,
  );
}

/**
 * The integral of `f` from `a` to `b`, by adaptive Simpson.
 *
 * Adaptive rather than a fixed number of strips: the accuracy of a fixed rule
 * depends on how wiggly the function is, which the sheet does not know and the
 * reader cannot see. Subdividing where the estimate disagrees with itself is
 * how the answer earns its own tolerance.
 */
export function integrate(f: Sampled, a: number, b: number, span: Span): number {
  if (a === b) return 0;
  const sign = b > a ? 1 : -1;
  const [lo, hi] = a < b ? [a, b] : [b, a];

  const simpson = (x0: number, x2: number, f0: number, f1: number, f2: number): number =>
    ((x2 - x0) / 6) * (f0 + 4 * f1 + f2);

  const sample = (x: number): number => {
    const y = f(x);
    if (!Number.isFinite(y)) {
      throw new CalcError("domain", "the function has no value inside the range", span);
    }
    return y;
  };

  let depthReached = 0;

  const refine = (
    x0: number,
    x2: number,
    f0: number,
    f1: number,
    f2: number,
    whole: number,
    tolerance: number,
    depth: number,
  ): number => {
    depthReached = Math.max(depthReached, depth);
    const xm1 = (x0 + (x0 + x2) / 2) / 2;
    const xm2 = ((x0 + x2) / 2 + x2) / 2;
    const fm1 = sample(xm1);
    const fm2 = sample(xm2);
    const left = simpson(x0, (x0 + x2) / 2, f0, fm1, f1);
    const right = simpson((x0 + x2) / 2, x2, f1, fm2, f2);
    const better = left + right;

    // Richardson: the two-panel estimate is fourth-order, so the difference
    // over fifteen is a good estimate of what remains.
    if (depth >= MAX_QUAD_DEPTH || Math.abs(better - whole) <= 15 * tolerance) {
      return better + (better - whole) / 15;
    }
    return (
      refine(x0, (x0 + x2) / 2, f0, fm1, f1, left, tolerance / 2, depth + 1) +
      refine((x0 + x2) / 2, x2, f1, fm2, f2, right, tolerance / 2, depth + 1)
    );
  };

  const f0 = sample(lo);
  const f1 = sample((lo + hi) / 2);
  const f2 = sample(hi);
  const whole = simpson(lo, hi, f0, f1, f2);
  // Relative to the size of the answer, with a floor for integrals near zero.
  const tolerance = Math.max(Math.abs(whole) * 1e-10, 1e-12);
  return sign * refine(lo, hi, f0, f1, f2, whole, tolerance, 0);
}

/**
 * The derivative of `f` at `x`, by a central difference with Richardson
 * extrapolation.
 *
 * Central rather than forward: its error falls as the square of the step
 * rather than linearly, for one extra evaluation. The step is scaled to `x`
 * because a fixed step is far too large near zero and lost in rounding at
 * 1e8.
 */
export function differentiate(f: Sampled, x: number, span: Span): number {
  const scale = Math.max(Math.abs(x), 1);
  const h = Math.cbrt(Number.EPSILON) * scale;

  const central = (step: number): number => {
    const up = f(x + step);
    const down = f(x - step);
    if (!Number.isFinite(up) || !Number.isFinite(down)) {
      throw new CalcError(
        "domain",
        "the function has no value on both sides of that point",
        span,
      );
    }
    return (up - down) / (2 * step);
  };

  const coarse = central(2 * h);
  const fine = central(h);
  // Two central differences of halved step cancel the leading error term.
  return (4 * fine - coarse) / 3;
}
