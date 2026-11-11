// Strategy lab: small statistics for the luck checks. Pure, tested.

import { seeded } from './control'

export interface MeanSe {
  n: number
  mean: number | null
  se: number | null
  /** mean / se (null under 2 values). */
  t: number | null
}

export function meanSe(xs: number[]): MeanSe {
  const n = xs.length
  if (!n) return { n, mean: null, se: null, t: null }
  const mean = xs.reduce((a, b) => a + b, 0) / n
  if (n < 2) return { n, mean, se: null, t: null }
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1))
  const se = sd / Math.sqrt(n)
  return { n, mean, se, t: se > 0 ? mean / se : null }
}

/** Standard normal upper tail, P(Z > z) (Abramowitz-Stegun 26.2.17, error under 1e-7). */
export function normalTail(z: number): number {
  if (z < 0) return 1 - normalTail(-z)
  const t = 1 / (1 + 0.2316419 * z)
  const d = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)
  const p =
    t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return d * p
}

/**
 * Random-direction test. For each signal, `real` is its result in R and
 * `flipped` the result of the opposite trade at the same time with mirrored
 * stop and target. If the direction call had no edge, each signal would be
 * either one with even odds. Returns z = how far the real sum sits above that
 * coin-flip average, in standard deviations, and the one-sided p-value
 * (normal approximation of the exact sign-flip test).
 */
export function directionTest(
  real: number[],
  flipped: number[],
): { n: number; z: number | null; p: number | null } {
  const n = Math.min(real.length, flipped.length)
  let s = 0
  let s2 = 0
  for (let i = 0; i < n; i++) {
    const d = (real[i] - flipped[i]) / 2
    s += d
    s2 += d * d
  }
  if (n < 2 || !(s2 > 0)) return { n, z: null, p: null }
  const z = s / Math.sqrt(s2)
  return { n, z, p: normalTail(z) }
}

/** Holm step-down: which p-values survive at family-wise level alpha. Order kept. */
export function holm(ps: (number | null)[], alpha = 0.05): boolean[] {
  const idx = ps
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => x.p != null)
    .sort((a, b) => a.p - b.p)
  const out = ps.map(() => false)
  const m = idx.length
  for (let k = 0; k < m; k++) {
    if (idx[k].p > alpha / (m - k)) break
    out[idx[k].i] = true
  }
  return out
}

/** z a single test must pass for Bonferroni over `m` tests (one-sided, alpha 0.05). */
export function bonferroniZ(m: number, alpha = 0.05): number {
  const target = alpha / Math.max(1, m)
  let lo = 0
  let hi = 10
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (normalTail(mid) > target) lo = mid
    else hi = mid
  }
  return hi
}

/** Bootstrap 95% interval of the mean (seeded, so a rerun gives the same numbers). */
export function bootstrapCi(xs: number[], runs = 2000, seed = 7): [number, number] | null {
  if (xs.length < 5) return null
  const rnd = seeded(seed)
  const means: number[] = []
  for (let r = 0; r < runs; r++) {
    let s = 0
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rnd() * xs.length)]
    means.push(s / xs.length)
  }
  means.sort((a, b) => a - b)
  return [means[Math.floor(runs * 0.025)], means[Math.floor(runs * 0.975)]]
}

/** Two-sided sign test p-value: `k` successes of `n` under even odds. */
export function signTest(k: number, n: number): number | null {
  if (!n) return null
  // Exact binomial with log-gamma free sums (n is at most a few hundred).
  const logC = (a: number, b: number) => {
    let s = 0
    for (let i = 1; i <= b; i++) s += Math.log(a - b + i) - Math.log(i)
    return s
  }
  const lo = Math.min(k, n - k)
  let p = 0
  for (let i = 0; i <= lo; i++) p += Math.exp(logC(n, i) - n * Math.LN2)
  return Math.min(1, 2 * p)
}
