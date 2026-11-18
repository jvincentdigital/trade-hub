// Levels study (docs/levels-study.md, "Swings" and "The levels"): swings of
// size 2, the zones Z4 and ZD with the two-turn zones, the Fibonacci levels
// F4C, F4J, FDC and FDJ, and the lines PD and PW. Each level carries the time
// it became known, its life and its band in time. Pure.

import { TOL, type NyChart, type Weeks } from './levelsClock'
import type { MinuteIndex } from './levelsIndex'

/** The ten kinds, in the plan's order, then the two-turn zones (not one of the ten). */
export const LEVEL_KINDS = [
  'R00',
  'R50',
  'PD',
  'PW',
  'Z4',
  'ZD',
  'F4C',
  'F4J',
  'FDC',
  'FDJ',
] as const
export type LevelKind = (typeof LEVEL_KINDS)[number] | 'Z4x2' | 'ZDx2'
export const ALL_KINDS: LevelKind[] = [...LEVEL_KINDS, 'Z4x2', 'ZDx2']

/** Sides a level may be visited from: 1 from below, 2 from above, 3 both. */
export const FROM_BELOW = 1
export const FROM_ABOVE = 2

/** A level of every kind except round numbers. */
export interface Level {
  id: number
  kind: LevelKind
  /** high or low (PD, PW); ceiling or floor (zones); floor:0.382 ... ceiling:J (Fibonacci). */
  what: string
  /** UTC second of the close it came from. */
  knownFrom: number
  sides: number
  /** First minute of its life (the first minute stamped at or after knownFrom). */
  start: number
  /** One past the last minute of its life as set by time and, for Fibonacci, by price. */
  lifeEnd: number
  /** Fibonacci: the life also ends at the end of its own first visit. */
  once: boolean
  /** The band in time: from minute from[i] on, the edges lo[i] and hi[i]; zones: turns[i] turns. */
  from: number[]
  lo: number[]
  hi: number[]
  turns: number[]
  /** For the twins' left-out rule: levels of one group are tested against each other. */
  group: string
  /** Fibonacci: the leg's ends (H the high, L the low); else NaN. */
  legHigh: number
  legLow: number
}

// ---------------------------------------------------------------- swings

/** A confirmed swing on a chart. */
export interface LevelSwing {
  /** 1 a high, -1 a low. */
  kind: 1 | -1
  /** Chart candle that holds the extreme. */
  idx: number
  price: number
  /** Chart candle at whose close it is confirmed. */
  confirm: number
  /** The candidate of the next swing at the confirmation. */
  next: number
}

/**
 * Swings of size 2 over the first `closed` candles (a candle that never closes
 * cannot confirm): the harmonic study's finder, with the confirmation tested
 * inclusively with the 1e-9 tolerance ("Data and clocks"), and "strictly
 * higher" and "strictly lower" on the prices as read.
 */
export function findLevelSwings(
  high: Float64Array,
  low: Float64Array,
  atr: Float64Array,
  closed: number,
  k = 2,
): LevelSwing[] {
  const out: LevelSwing[] = []
  if (closed <= 0) return out
  let kind: 1 | -1 = 1
  let cand = 0
  let candP = high[0]
  for (let i = 1; i < closed; i++) {
    const a = atr[i]
    if (kind === 1) {
      if (high[i] > candP) {
        cand = i
        candP = high[i]
        continue
      }
      if (a === a && low[i] <= candP - k * a + TOL) {
        let j = cand + 1
        let p = low[j]
        for (let q = cand + 2; q <= i; q++)
          if (low[q] < p) {
            j = q
            p = low[q]
          }
        out.push({ kind: 1, idx: cand, price: candP, confirm: i, next: p })
        kind = -1
        cand = j
        candP = p
      }
    } else {
      if (low[i] < candP) {
        cand = i
        candP = low[i]
        continue
      }
      if (a === a && high[i] >= candP + k * a - TOL) {
        let j = cand + 1
        let p = high[j]
        for (let q = cand + 2; q <= i; q++)
          if (high[q] > p) {
            j = q
            p = high[q]
          }
        out.push({ kind: -1, idx: cand, price: candP, confirm: i, next: p })
        kind = 1
        cand = j
        candP = p
      }
    }
  }
  return out
}

/** First minute stamped at or after the close of chart candle c (c must be closed). */
const effAt = (chart: NyChart, c: number) => chart.first[c + 1]

/** Candles of a chart that close: all but the last (no minute after it in its file). */
export const closedCandles = (chart: NyChart) => Math.max(0, chart.n - 1)

// ---------------------------------------------------------------- zones

/** One zone's story: its turns and its death. */
export interface Zone {
  /** 1 a ceiling (from swing highs), -1 a floor. */
  type: 1 | -1
  /** Candle of each turn's confirmation, and the band after it. */
  turnAt: number[]
  lo: number[]
  hi: number[]
  /** Candle at whose close it died, or -1. */
  death: number
}

/**
 * Zones of one chart ("Z4 and ZD"): at each candle's close the deaths come
 * first (a close at or beyond the far side of the band by 0.25 x that candle's
 * ATR, or the `life`-th candle after the latest turn), then the swing that
 * candle confirmed joins the zone whose middle is nearest (the older on a
 * tie) among those that would stay no wider than 0.5 x the ATR at it, or
 * starts a new one.
 */
export function buildZones(chart: NyChart, swings: LevelSwing[], life: number): Zone[] {
  const all: Zone[] = []
  const alive: { z: Zone; lo: number; hi: number; last: number }[] = []
  const swingAt = new Map<number, LevelSwing>()
  for (const s of swings) swingAt.set(s.confirm, s)
  const closed = closedCandles(chart)
  for (let c = 0; c < closed; c++) {
    const cl = chart.close[c]
    const a = chart.atr[c]
    for (let i = 0; i < alive.length; i++) {
      const v = alive[i]
      const out = v.z.type === 1 ? cl >= v.hi + 0.25 * a - TOL : cl <= v.lo - 0.25 * a + TOL
      if (out || c === v.last + life) {
        v.z.death = c
        alive.splice(i, 1)
        i--
      }
    }
    const s = swingAt.get(c)
    if (!s) continue
    const h = s.price
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < alive.length; i++) {
      const v = alive[i]
      if (v.z.type !== s.kind) continue
      const lo = Math.min(v.lo, h)
      const hi = Math.max(v.hi, h)
      if (hi - lo > 0.5 * a + TOL) continue
      const d = Math.abs((v.lo + v.hi) / 2 - h)
      if (best < 0 || d < bestD - TOL) {
        best = i
        bestD = d
      }
    }
    if (best >= 0) {
      const v = alive[best]
      v.lo = Math.min(v.lo, h)
      v.hi = Math.max(v.hi, h)
      v.last = c
      v.z.turnAt.push(c)
      v.z.lo.push(v.lo)
      v.z.hi.push(v.hi)
    } else {
      const z: Zone = { type: s.kind, turnAt: [c], lo: [h], hi: [h], death: -1 }
      all.push(z)
      alive.push({ z, lo: h, hi: h, last: c })
    }
  }
  return all
}

/**
 * The levels a zone gives: a two-turn zone from its second turn's close until
 * its third turn or its death, and an armed zone from its third turn's close
 * until its death, its band widening at each later turn.
 */
export function zoneLevels(
  chart: NyChart,
  zones: Zone[],
  kind: 'Z4' | 'ZD',
  n: number,
  push: (l: Omit<Level, 'id'>) => void,
): void {
  const two = kind === 'Z4' ? 'Z4x2' : 'ZDx2'
  for (const z of zones) {
    const what = z.type === 1 ? 'ceiling' : 'floor'
    const sides = z.type === 1 ? FROM_BELOW : FROM_ABOVE
    const deathAt = z.death >= 0 ? effAt(chart, z.death) : n
    if (z.turnAt.length >= 2) {
      const j2 = z.turnAt[1]
      push({
        kind: two,
        what,
        knownFrom: chart.stop[j2],
        sides,
        start: effAt(chart, j2),
        lifeEnd: z.turnAt.length >= 3 ? effAt(chart, z.turnAt[2]) : deathAt,
        once: false,
        from: [effAt(chart, j2)],
        lo: [z.lo[1]],
        hi: [z.hi[1]],
        turns: [2],
        group: two,
        legHigh: NaN,
        legLow: NaN,
      })
    }
    if (z.turnAt.length >= 3) {
      const from: number[] = []
      const lo: number[] = []
      const hi: number[] = []
      const turns: number[] = []
      for (let t = 2; t < z.turnAt.length; t++) {
        from.push(effAt(chart, z.turnAt[t]))
        lo.push(z.lo[t])
        hi.push(z.hi[t])
        turns.push(t + 1)
      }
      push({
        kind,
        what,
        knownFrom: chart.stop[z.turnAt[2]],
        sides,
        start: from[0],
        lifeEnd: deathAt,
        once: false,
        from,
        lo,
        hi,
        turns,
        group: kind,
        legHigh: NaN,
        legLow: NaN,
      })
    }
  }
}

// ---------------------------------------------------------------- Fibonacci

export const FIB_CLASSIC = [
  [0.382, '0.382'],
  [0.5, '0.5'],
  [0.618, '0.618'],
] as const
export const FIB_J = [0.786, 0.886] as const

/**
 * Fibonacci levels of one chart: when a swing high H is confirmed with L the
 * confirmed low before it, floors at H - r x (H - L) (the classic three, and
 * John's band from 0.786 to 0.886); a swing low gives ceilings the same way.
 * A level is not used when the candidate at the confirmation already reached
 * its near-side edge. Life: from the confirming close until the next swing's
 * confirming close, a minute at or beyond the leg's end (after that minute's
 * tests), or the end of its own first visit.
 */
export function fibLevels(
  chart: NyChart,
  swings: LevelSwing[],
  chartName: '4' | 'D',
  ix: MinuteIndex,
  n: number,
  push: (l: Omit<Level, 'id'>) => void,
): void {
  const group = `F${chartName}`
  for (let i = 1; i < swings.length; i++) {
    const s = swings[i]
    const p = swings[i - 1]
    const start = effAt(chart, s.confirm)
    const nextAt = i + 1 < swings.length ? effAt(chart, swings[i + 1].confirm) : n
    const H = s.kind === 1 ? s.price : p.price
    const L = s.kind === 1 ? p.price : s.price
    const priceEnd = s.kind === 1 ? ix.firstHigh(start, n, H - TOL) : ix.firstLow(start, n, L + TOL)
    const lifeEnd = Math.min(nextAt, priceEnd >= 0 ? priceEnd + 1 : n)
    const side = s.kind === 1 ? 'floor' : 'ceiling'
    const sides = s.kind === 1 ? FROM_ABOVE : FROM_BELOW
    const bands: [string, string, number, number][] = []
    for (const [r, label] of FIB_CLASSIC) {
      const x = s.kind === 1 ? H - r * (H - L) : L + r * (H - L)
      bands.push([`F${chartName}C`, `${side}:${label}`, x, x])
    }
    if (s.kind === 1)
      bands.push([`F${chartName}J`, `${side}:J`, H - FIB_J[1] * (H - L), H - FIB_J[0] * (H - L)])
    else bands.push([`F${chartName}J`, `${side}:J`, L + FIB_J[0] * (H - L), L + FIB_J[1] * (H - L)])
    for (const [kind, what, lo, hi] of bands) {
      const unused = s.kind === 1 ? s.next <= hi + TOL : s.next >= lo - TOL
      if (unused) continue
      push({
        kind: kind as LevelKind,
        what,
        knownFrom: chart.stop[s.confirm],
        sides,
        start,
        lifeEnd,
        once: true,
        from: [start],
        lo: [lo],
        hi: [hi],
        turns: [0],
        group,
        legHigh: H,
        legLow: L,
      })
    }
  }
}

// ---------------------------------------------------------------- PD and PW

/** PD: on each day, the previous day's high and low, live for the day, from either side. */
export function dayLevels(days: NyChart, push: (l: Omit<Level, 'id'>) => void): void {
  for (let d = 1; d < days.n; d++) {
    for (const [what, x] of [
      ['high', days.high[d - 1]],
      ['low', days.low[d - 1]],
    ] as const)
      push({
        kind: 'PD',
        what,
        knownFrom: days.stop[d - 1],
        sides: FROM_BELOW | FROM_ABOVE,
        start: days.first[d],
        lifeEnd: days.end[d],
        once: false,
        from: [days.first[d]],
        lo: [x],
        hi: [x],
        turns: [0],
        group: 'PD',
        legHigh: NaN,
        legLow: NaN,
      })
  }
}

/** PW: in each week, the previous week's high and low, live for the whole week. */
export function weekLevels(
  days: NyChart,
  weeks: Weeks,
  push: (l: Omit<Level, 'id'>) => void,
): void {
  for (let w = 1; w < weeks.n; w++) {
    const start = days.first[weeks.firstDay[w]]
    for (const [what, x] of [
      ['high', weeks.high[w - 1]],
      ['low', weeks.low[w - 1]],
    ] as const)
      push({
        kind: 'PW',
        what,
        knownFrom: days.stop[weeks.lastDay[w - 1]],
        sides: FROM_BELOW | FROM_ABOVE,
        start,
        lifeEnd: days.end[weeks.lastDay[w]],
        once: false,
        from: [start],
        lo: [x],
        hi: [x],
        turns: [0],
        group: 'PW',
        legHigh: NaN,
        legLow: NaN,
      })
  }
}

/** Index of the band segment in force at minute m (the last with from <= m; 0 before the first). */
export function segmentAt(l: { from: number[] }, m: number): number {
  let s = 0
  while (s + 1 < l.from.length && l.from[s + 1] <= m) s++
  return s
}
