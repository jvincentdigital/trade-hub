// Levels study (docs/levels-study.md, Amendment 1, A): the mirrored-minutes
// series. The real 1-minute candles in their real order and at their real
// stamps, each minute either kept or turned upside down. Whether a minute is
// turned is decided by its clock minute alone, the same in every market: one
// mulberry32 generator per seed, drawn once for every clock minute from
// 2000-01-01 00:00 UTC on, whether or not a market has a candle in it; a
// minute whose draw is below 0.5 is turned. Pure.

import type { Bars } from './harmonicFind'

/** 2000-01-01 00:00 UTC: clock minute 0 of the draws. */
export const MIRROR_FROM = 946_684_800

export const MIRROR_GENERATOR =
  'mulberry32 (src/lib/lab/harmonicStudy.ts) seeded with the seed number; the k-th draw belongs to the clock minute k minutes after 2000-01-01 00:00 UTC, in every market; a minute whose draw is below 0.5 is turned'

/**
 * The k-th draw (k = 0 is the first) of mulberry32(seed), worked out
 * directly: the generator's state after k + 1 steps is (seed + (k + 1) x
 * 0x6d2b79f5) mod 2^32, then the same output step as mulberry32.
 */
export function drawAt(seed: number, k: number): number {
  let t = ((seed >>> 0) + Math.imul(k + 1, 0x6d2b79f5)) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Whether the minute stamped t (UTC seconds) is turned; a stamp that is not a whole minute after 2000 stops the program. */
export function turned(seed: number, t: number): boolean {
  const k = (t - MIRROR_FROM) / 60
  if (!Number.isInteger(k) || k < 0)
    throw new Error(`mirrored minutes: stamp ${t} is not a whole minute from 2000-01-01 on`)
  return drawAt(seed, k) < 0.5
}

/**
 * Amendment 1, A. With o, h, l, c the minute's real prices, p the real close
 * before it and P the new close before it (the first minute: both its own
 * open), a kept minute gets O = P x o / p, C = O x c / o, H = max(O, C) x h /
 * max(o, c), L = min(O, C) x l / min(o, c); a turned minute gets O = P x p /
 * o, C = O x o / c, H = max(O, C) x min(o, c) / l, L = min(O, C) x max(o, c)
 * / h. The wick ratios are divided first, so H >= max(O, C) and L <= min(O,
 * C) hold exactly in floating point. Stamps unchanged.
 */
export function mirrorMinutes(bars: Bars, seed: number): Bars {
  const n = bars.n
  const open = new Float64Array(n)
  const high = new Float64Array(n)
  const low = new Float64Array(n)
  const close = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const o = bars.open[i]
    const h = bars.high[i]
    const l = bars.low[i]
    const c = bars.close[i]
    const p = i ? bars.close[i - 1] : o
    const P = i ? close[i - 1] : o
    let O: number
    let C: number
    let H: number
    let L: number
    if (turned(seed, bars.time[i])) {
      O = P * (p / o)
      C = O * (o / c)
      H = Math.max(O, C) * (Math.min(o, c) / l)
      L = Math.min(O, C) * (Math.max(o, c) / h)
    } else {
      O = P * (o / p)
      C = O * (c / o)
      H = Math.max(O, C) * (h / Math.max(o, c))
      L = Math.min(O, C) * (l / Math.min(o, c))
    }
    open[i] = O
    high[i] = H
    low[i] = L
    close[i] = C
  }
  return { n, time: bars.time.slice(), open, high, low, close }
}
