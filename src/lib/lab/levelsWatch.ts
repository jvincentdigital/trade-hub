// Levels study (docs/levels-study.md, "A visit, and what happens after it"):
// the watch of a level or a twin (away, touch, the order inside a minute, the
// frozen edges of a visit, its end) and what follows a visit (the race at four
// distances, fifteen and sixty minutes later, how far, after a break). Pure.
//
// A watcher jumps straight to the next minute that can change anything for it
// (MinuteIndex), and works out that minute exactly; the minutes it skips are
// ones in which, by the plan's rules, nothing happens to it.

import { MARKET_COSTS, type Bars, type Chart, type HarmonicMarket } from './harmonicFind'
import { minuteAtOrAfter } from './harmonicTrade'
import {
  atrInForce,
  buildDays,
  buildQuarters,
  fifteenthDay,
  roundGrid,
  TOL,
  type NyChart,
  type RoundGrid,
} from './levelsClock'
import { MinuteIndex } from './levelsIndex'
import type { MarketCosts } from './harmonicFind'

/** Everything about one market's file that the watch and the trades read. */
export interface LevelsCtx {
  market: HarmonicMarket
  bars: Bars
  n: number
  ix: MinuteIndex
  days: NyChart
  /** ATR in force for the minutes of each day. */
  inForce: Float64Array
  /** 15-minute candles. */
  q: Chart
  /** First minute of the 15th day. */
  f15: number
  costs: MarketCosts
  grid: RoundGrid
}

export function levelsContext(
  bars: Bars,
  market: HarmonicMarket,
  days = buildDays(bars),
): LevelsCtx {
  return {
    market,
    bars,
    n: bars.n,
    ix: new MinuteIndex(bars.high, bars.low, bars.n),
    days,
    inForce: atrInForce(days),
    q: buildQuarters(bars),
    f15: fifteenthDay(days, bars.n),
    costs: MARKET_COSTS[market],
    grid: roundGrid(market),
  }
}

/** ATR in force in minute m. */
export const atrAt = (ctx: LevelsCtx, m: number) => ctx.inForce[ctx.days.ofMinute[m]]

// ---------------------------------------------------------------- the watch

/** What is watched: a level, a twin (the level's band moved by `shift`) or a round line. */
export interface Watcher {
  /** 1 from below, 2 from above, 3 both. */
  sides: number
  /** First watched minute. */
  first: number
  /** One past the last minute of its life (set by time and price). */
  lifeEnd: number
  /** Fibonacci levels and twins: the life ends at the end of the first visit. */
  once: boolean
  from: number[]
  lo: number[]
  hi: number[]
  turns: number[]
  shift: number
  /** UTC second it became known (NaN for round numbers): no touch may come earlier. */
  knownFrom: number
}

/** A visit as the watch sees it. Indices are 1-minute bars. */
export interface Touch {
  touch: number
  /** 1 a visit from below, -1 from above. */
  dir: 1 | -1
  near: number
  far: number
  /** ATR in force at the touch minute, and g = 0.25 x it. */
  atr: number
  g: number
  /** End minute, or -1 if the file ended first. */
  end: number
  /** 1 turn, 2 break, 0 open. */
  endKind: 0 | 1 | 2
  /** Zones: turns at the touch minute. */
  turns: number
  /** 1 for the first visit of this watcher, 2 for the next... */
  seq: number
}

export interface WatchEnd {
  /** What is remembered after the last minute watched: 0 nothing, 1 away below, 2 away above. */
  mem: number
  /** Touch minute of a visit still open at the end of the file, or -1. */
  open: number
  /** Last minute of its life (inclusive), or -1 if never watched. */
  lastLive: number
  visits: number
}

/** Optional snapshots: the state after each minute in `at` (sorted bar indices). */
export interface Snaps {
  at: Int32Array
  put: (minute: number, lo: number, hi: number, mem: number, open: number) => void
}

const KNOWN_FROM = 'Known from: a touch is earlier than the time its level became known'

/** Watch one level or twin through its life; calls onTouch for each visit, in order. */
export function watch(
  ctx: LevelsCtx,
  w: Watcher,
  onTouch: (t: Touch) => void,
  snaps?: Snaps,
): WatchEnd {
  const { ix, n } = ctx
  const { high, low, time } = ctx.bars
  const dayOf = ctx.days.ofMinute
  const dayEnd = ctx.days.end
  const { from, sides, shift, lifeEnd } = w
  const nseg = from.length
  if (w.first >= lifeEnd) return { mem: 0, open: -1, lastLive: -1, visits: 0 }
  if (time[w.first] < w.knownFrom)
    throw new Error(`${KNOWN_FROM} (level built after its first minute)`)
  let m = w.first
  let mem = 0
  let seg = 0
  let visits = 0
  let sp = 0
  if (snaps) while (sp < snaps.at.length && snaps.at[sp] < w.first) sp++
  const rec = (upTo: number, open: number) => {
    if (!snaps) return
    while (sp < snaps.at.length && snaps.at[sp] <= upTo) {
      const s = snaps.at[sp++]
      let k = 0
      while (k + 1 < nseg && from[k + 1] <= s) k++
      snaps.put(s, w.lo[k] + shift, w.hi[k] + shift, open >= 0 ? 0 : mem, open)
    }
  }
  while (m < lifeEnd) {
    while (seg + 1 < nseg && from[seg + 1] <= m) seg++
    const lo = w.lo[seg] + shift
    const hi = w.hi[seg] + shift
    const day = dayOf[m]
    const g = 0.25 * ctx.inForce[day]
    let segEnd = lifeEnd
    if (seg + 1 < nseg && from[seg + 1] < segEnd) segEnd = from[seg + 1]
    let up = Infinity
    let dn = -Infinity
    let useG = false
    if (mem === 1) {
      if ((sides & 1) !== 0) up = lo - TOL
      else {
        up = hi + g - TOL
        useG = true
      }
    } else if (mem === 2) {
      if ((sides & 2) !== 0) dn = hi + TOL
      else {
        dn = lo - g + TOL
        useG = true
      }
    } else {
      up = hi + g - TOL
      dn = lo - g + TOL
      useG = true
    }
    if (useG && dayEnd[day] < segEnd) segEnd = dayEnd[day]
    const e = ix.firstEither(m, segEnd, up, dn)
    if (e < 0) {
      rec(segEnd - 1, -1)
      m = segEnd
      continue
    }
    rec(e - 1, -1)
    // The ATR in force (and g) of the event minute's own day: a segment that needs no g may span days.
    const atr = ctx.inForce[dayOf[e]]
    const ge = 0.25 * atr
    let dir: 0 | 1 | -1 = 0
    if (mem === 1 && (sides & 1) !== 0 && high[e] >= lo - TOL) dir = 1
    else if (mem === 2 && (sides & 2) !== 0 && low[e] <= hi + TOL) dir = -1
    if (dir === 0) {
      const below = low[e] <= lo - ge + TOL
      const above = high[e] >= hi + ge - TOL
      mem = below && above ? 0 : below ? 1 : above ? 2 : mem
      m = e + 1
      continue
    }
    if (time[e] < w.knownFrom) throw new Error(KNOWN_FROM)
    const near = dir === 1 ? lo : hi
    const far = dir === 1 ? hi : lo
    let end = -1
    let endKind: 0 | 1 | 2 = 0
    if (dir === 1) {
      const a = ix.firstLow(e + 1, n, near - ge + TOL)
      const b = ix.firstHigh(e + 1, a >= 0 ? a + 1 : n, far + ge - TOL)
      if (b >= 0) {
        end = b
        endKind = 2
      } else if (a >= 0) {
        end = a
        endKind = 1
      }
    } else {
      const a = ix.firstHigh(e + 1, n, near + ge - TOL)
      const b = ix.firstLow(e + 1, a >= 0 ? a + 1 : n, far - ge + TOL)
      if (b >= 0) {
        end = b
        endKind = 2
      } else if (a >= 0) {
        end = a
        endKind = 1
      }
    }
    visits++
    onTouch({
      touch: e,
      dir,
      near,
      far,
      atr,
      g: ge,
      end,
      endKind,
      turns: w.turns[seg],
      seq: visits,
    })
    if (end < 0) {
      rec(n - 1, e)
      return { mem: 0, open: e, lastLive: lifeEnd - 1, visits }
    }
    rec(end - 1, e)
    mem = (endKind === 1) === (dir === 1) ? 1 : 2
    if (w.once) return { mem, open: -1, lastLive: Math.min(lifeEnd - 1, end), visits }
    m = end + 1
  }
  rec(lifeEnd - 1, -1)
  return { mem, open: -1, lastLive: lifeEnd - 1, visits }
}

// ---------------------------------------------------------------- after a touch

export const DISTANCES = [0.1, 0.25, 0.5, 1] as const
/** Window of each distance's race (and of the runs after a break), in hours. */
export const WINDOW_HOURS = [24, 24, 120, 120] as const

/** 0 neither, 1 turn (run), 2 break (fail). */
export type Outcome3 = 0 | 1 | 2

export interface VisitMeasure {
  /** The race at each distance: 0 neither, 1 turn, 2 break; and the deciding minute or -1. */
  race: Outcome3[]
  raceAt: number[]
  /** Fifteen and sixty minutes later: 0 at the level, 1 back, 2 through. */
  m15: Outcome3
  m60: Outcome3
  /** How far, in price. */
  howFar: number
  /** The break minute, or -1. */
  brk: number
  /** After the break, at each distance: 0 neither, 1 run, 2 fail (-1 when there is no break minute). */
  run: (Outcome3 | -1)[]
  runAt: number[]
  /** The last minute needed to settle all of the above, or -1 if the end of the data came first. */
  done: number
}

/** First minute in [from, to) at or beyond x on side s (1: Bid high >= x, -1: Bid low <= x), with the tolerance. */
export const toward = (ix: MinuteIndex, s: 1 | -1, from: number, to: number, x: number) =>
  s === 1 ? ix.firstHigh(from, to, x - TOL) : ix.firstLow(from, to, x + TOL)

/** One past the last minute stamped earlier than t (searching from `from`). */
export const before = (bars: Bars, t: number, from: number) => minuteAtOrAfter(bars, t, from)

/** The race, the 15 and 60 minute answers, how far and after a break, for one visit. */
export function measureVisit(ctx: LevelsCtx, v: Touch): VisitMeasure {
  const { ix, n, bars } = ctx
  const { touch: tm, dir, near, far, atr, end } = v
  const t = bars.time[tm]
  let done = tm
  const settle = (x: number) => {
    if (x < 0 || done < 0) done = -1
    else if (x > done) done = x
  }
  settle(end)
  const w24 = before(bars, t + 24 * 3600, tm + 1)
  const w120 = before(bars, t + 120 * 3600, w24)
  const race: Outcome3[] = []
  const raceAt: number[] = []
  for (let k = 0; k < 4; k++) {
    const d = DISTANCES[k] * atr
    const wEnd = WINDOW_HOURS[k] === 24 ? w24 : w120
    const jt = toward(ix, dir === 1 ? -1 : 1, tm + 1, wEnd, near - dir * d)
    const jb = toward(ix, dir, tm + 1, jt >= 0 ? jt + 1 : wEnd, far + dir * d)
    if (jb >= 0) {
      race.push(2)
      raceAt.push(jb)
      settle(jb)
    } else if (jt >= 0) {
      race.push(1)
      raceAt.push(jt)
      settle(jt)
    } else {
      race.push(0)
      raceAt.push(-1)
      settle(wEnd < n ? wEnd : -1)
    }
  }
  const later = (minutes: number): Outcome3 => {
    const k = before(bars, t + minutes * 60, tm + 1)
    settle(k < n ? k : -1)
    const c = bars.close[k - 1]
    if (dir === 1) return c < near - TOL ? 1 : c > far + TOL ? 2 : 0
    return c > near + TOL ? 1 : c < far - TOL ? 2 : 0
  }
  const m15 = later(15)
  const m60 = later(60)
  const b25 = toward(ix, dir, tm + 1, w24, far + dir * 0.25 * atr)
  const to = b25 >= 0 ? b25 : w24
  settle(b25 >= 0 ? b25 : w24 < n ? w24 : -1)
  const ext = dir === 1 ? near - ix.minLow(tm + 1, to) : ix.maxHigh(tm + 1, to) - near
  const howFar = ext > 0 ? ext : 0
  const P = far + dir * 0.1 * atr
  const endLim = end >= 0 ? end + 1 : n
  const lim = Math.min(endLim, w24)
  const brk = toward(ix, dir, tm, lim, P)
  const run: (Outcome3 | -1)[] = []
  const runAt: number[] = []
  if (brk < 0) {
    settle(endLim <= w24 ? (end >= 0 ? end : -1) : w24 < n ? w24 : -1)
    for (let k = 0; k < 4; k++) {
      run.push(-1)
      runAt.push(-1)
    }
  } else {
    settle(brk)
    const tb = bars.time[brk]
    const b24 = before(bars, tb + 24 * 3600, brk + 1)
    const b120 = before(bars, tb + 120 * 3600, b24)
    for (let k = 0; k < 4; k++) {
      const d = DISTANCES[k] * atr
      const wEnd = WINDOW_HOURS[k] === 24 ? b24 : b120
      const jf = toward(ix, dir === 1 ? -1 : 1, brk + 1, wEnd, P - dir * d)
      const jr = toward(ix, dir, brk + 1, jf >= 0 ? jf : wEnd, P + dir * d)
      if (jr >= 0) {
        run.push(1)
        runAt.push(jr)
        settle(jr)
      } else if (jf >= 0) {
        run.push(2)
        runAt.push(jf)
        settle(jf)
      } else {
        run.push(0)
        runAt.push(-1)
        settle(wEnd < n ? wEnd : -1)
      }
    }
  }
  return { race, raceAt, m15, m60, howFar, brk, run, runAt, done }
}
