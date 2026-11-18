// Levels study (docs/levels-study.md): the records handed to the runner (a
// level, a visit with its race and after-break outcomes, a trade and its two
// exits), the twin sums, and the twins' placement with their left-out rule.
// Pure.

import { weekOf } from './harmonicStats'
import { nearRound, TOL, type RoundGrid } from './levelsClock'
import type { LevelKind } from './levelsBuild'
import type { TradeName, TradeResult } from './levelsTrade'
import type { LevelsCtx, Touch, VisitMeasure } from './levelsWatch'

/** Twin sets m = 0.40, 0.41 ... 0.85. */
export const TWIN_SETS = Array.from({ length: 46 }, (_, i) => (40 + i) / 100)
export const TWIN_SET_LABELS = TWIN_SETS.map((m) => m.toFixed(2))
/** Placebo 1: the set (and grid) treated as the level, and the sets at least 0.10 (5 pips, $1) away. */
export const PLACEBO_SET = 20
export const placeboFar = (set: number) => Math.abs(set - PLACEBO_SET) >= 10

/** The pool a twin belongs to: its level's kind, or RTW for the round-number grids. */
export type Pool = LevelKind | 'RTW'

// ---------------------------------------------------------------- records

export type Side = 'below' | 'above'
export const RACE_WORDS = ['neither', 'turn', 'break'] as const
export const RUN_WORDS = ['neither', 'run', 'fail'] as const
export const LATER_WORDS = ['at', 'back', 'through'] as const

export interface LevelRec {
  id: number
  kind: LevelKind
  what: string
  knownFrom: number
  /** First watched minute (UTC second) and its UTC year. */
  firstWatched: number
  year: number
  /** Edges and ATR in force in the first watched minute. */
  low: number
  high: number
  atr: number
  /** It sits on a round number (left out of its kind, reported apart). */
  leftOut: boolean
  sides: number
  /** Zones: turns at the first watched minute. */
  turns: number
  /** Last minute of its life (UTC second). */
  lastLive: number
  visits: number
  /** Twins watched (not left out), of 46 per side. */
  twins: number
}

export interface ExitRec {
  how: 'stop' | 'target' | 'time' | 'end'
  at: number
  price: number
  /** In R after costs, before costs, at double cost; in pips after and before costs. */
  after: number
  before: number
  double: number
  pips: number
  pipsBefore: number
}

export interface TradeRec {
  name: TradeName
  status: TradeResult['status']
  /** 1 buy, -1 sell. */
  dir: 1 | -1
  /** Fill minute (UTC second) and its UTC year and counting week, or null. */
  fill: number | null
  year: number | null
  week: number | null
  entry: number
  stop: number
  R: number
  spread: number
  /** quick, hold. */
  exits: ExitRec[]
  /** UTC second of the minute that settled it, or null when the end of the data came first. */
  done: number | null
}

export interface VisitRec {
  kind: Pool
  /** 'level' for a level or a round number; a twin set's or a twin grid's label. */
  twin: string
  /** Twin set (0 to 45) or grid (0 to 40) index; -1 for a level. */
  set: number
  what: string
  /** null for round numbers and grid lines. */
  knownFrom: number | null
  /** Level id (levels and their twins), -1 for round numbers and grid lines. */
  level: number
  side: Side
  touch: number
  year: number
  /** Counting week (Saturday 00:00 UTC weeks) of the touch. */
  week: number
  near: number
  far: number
  atr: number
  /** Zones: turns at the touch minute (0 for other kinds). */
  turns: number
  /** 1 for the level's (or twin's) first visit. */
  seq: number
  /** The level sits on a round number. */
  leftOut: boolean
  /** The range of the touch minute's day over the ATR in force (Limits: days over 1.5 x ATR). */
  dayRangeAtr: number
  end: 'turn' | 'break' | 'open'
  endAt: number | null
  race: (typeof RACE_WORDS)[number][]
  raceAt: (number | null)[]
  m15: (typeof LATER_WORDS)[number]
  m60: (typeof LATER_WORDS)[number]
  howFar: number
  brkAt: number | null
  /** 'none' when there is no break minute. */
  run: ((typeof RUN_WORDS)[number] | 'none')[]
  runAt: (number | null)[]
  /** UTC second by which every outcome above was settled, or null (the end of the data came first). */
  done: number | null
  /** T0, T1, B0 (left empty for twin visits in the year lists). */
  trades: TradeRec[]
}

// ---------------------------------------------------------------- twin sums

/** Fields of a twin visit cell. Per distance k (0.10, 0.25, 0.50, 1.00): turn + k, brk + k, run + k, fail + k. */
export const TV = {
  n: 0,
  turn: 1,
  brk: 5,
  /** Visits with a break minute. */
  hasBrk: 9,
  run: 10,
  fail: 14,
  back15: 18,
  through15: 19,
  back60: 20,
  through60: 21,
  /** Sums of how far in price and in ATR. */
  howFar: 22,
  howFarAtr: 23,
  /** Visits whose T0 order filled. */
  t0Fill: 24,
  /** Sum of the ATR at the touch. */
  atr: 25,
  endTurn: 26,
  endBreak: 27,
  size: 28,
} as const

/** Fields of each (trade, exit) block of a twin trade cell; block (k x 2 + e) x TT.size for trade k, exit e. */
export const TT = {
  n: 0,
  target: 1,
  after: 2,
  before: 3,
  double: 4,
  pips: 5,
  pipsBefore: 6,
  size: 7,
} as const
export const TT_SIZE = 6 * TT.size

export interface TwinCell {
  pool: Pool
  year: number
  /** 1 from below, -1 from above. */
  side: 1 | -1
  /** Counting week, or -1 in the by-set cells. */
  week: number
  /** Twin set or grid index (by-set cells); placebo cells: 0 the placebo set, 1 the far sets; -1 in the weekly cells. */
  set: number
  v: Float64Array
}

export interface TwinSums {
  /** Twin visits by pool, touch year, side and touch week, all sets together. */
  visitsByWeek: TwinCell[]
  /** Twin visits by pool, touch year, side and set. */
  visitsBySet: TwinCell[]
  /** Placebo 1: the placebo set (set 0) and the far sets (set 1), by pool, touch year, side and week. */
  placebo: TwinCell[]
  /** Twin trades by pool, fill year, side and fill week, all sets together. */
  tradesByWeek: TwinCell[]
  /** Twin trades by pool, fill year, side and set. */
  tradesBySet: TwinCell[]
}

export class CellMap {
  private m = new Map<string, TwinCell>()
  constructor(private size: number) {}
  get(pool: Pool, year: number, side: 1 | -1, week: number, set: number): Float64Array {
    const key = `${pool}|${year}|${side}|${week}|${set}`
    let c = this.m.get(key)
    if (!c) {
      c = { pool, year, side, week, set, v: new Float64Array(this.size) }
      this.m.set(key, c)
    }
    return c.v
  }
  list = () => [...this.m.values()]
}

// ---------------------------------------------------------------- years

const YEAR_STARTS: number[] = []
for (let y = 1970; y <= 2101; y++) YEAR_STARTS.push(Date.UTC(y, 0, 1) / 1000)
/** UTC year of a second. */
export function utcYear(t: number): number {
  let lo = 0
  let hi = YEAR_STARTS.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (YEAR_STARTS[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return 1970 + lo
}

export const sideOf = (dir: 1 | -1): Side => (dir === 1 ? 'below' : 'above')
export const stamp = (ctx: LevelsCtx, i: number) => (i >= 0 ? ctx.bars.time[i] : null)

export function tradeRec(ctx: LevelsCtx, t: TradeResult): TradeRec {
  const pip = ctx.costs.pip
  const fill = stamp(ctx, t.fill)
  return {
    name: t.name,
    status: t.status,
    dir: t.dir,
    fill,
    year: fill === null ? null : utcYear(fill),
    week: fill === null ? null : weekOf(fill),
    entry: t.entry,
    stop: t.stop,
    R: t.R,
    spread: t.spread,
    exits: t.exits.map((x) => ({
      how: x.how,
      at: ctx.bars.time[x.at],
      price: x.price,
      after: x.after,
      before: x.before,
      double: x.double,
      pips: x.pnl / pip,
      pipsBefore: (x.pnl + x.cost) / pip,
    })),
    done: stamp(ctx, t.done),
  }
}

export function visitRec(
  ctx: LevelsCtx,
  v: Touch,
  ms: VisitMeasure,
  trades: TradeResult[] | null,
  id: {
    kind: Pool
    twin: string
    set: number
    what: string
    knownFrom: number | null
    level: number
    leftOut: boolean
  },
): VisitRec {
  const t = ctx.bars.time[v.touch]
  const day = ctx.days.ofMinute[v.touch]
  return {
    ...id,
    dayRangeAtr: (ctx.days.high[day] - ctx.days.low[day]) / v.atr,
    side: sideOf(v.dir),
    touch: t,
    year: utcYear(t),
    week: weekOf(t),
    near: v.near,
    far: v.far,
    atr: v.atr,
    turns: v.turns,
    seq: v.seq,
    end: v.endKind === 1 ? 'turn' : v.endKind === 2 ? 'break' : 'open',
    endAt: stamp(ctx, v.end),
    race: ms.race.map((r) => RACE_WORDS[r]),
    raceAt: ms.raceAt.map((i) => stamp(ctx, i)),
    m15: LATER_WORDS[ms.m15],
    m60: LATER_WORDS[ms.m60],
    howFar: ms.howFar,
    brkAt: stamp(ctx, ms.brk),
    run: ms.run.map((r) => (r === -1 ? 'none' : RUN_WORDS[r])),
    runAt: ms.runAt.map((i) => stamp(ctx, i)),
    done: stamp(ctx, ms.done),
    trades: trades ? trades.map((x) => tradeRec(ctx, x)) : [],
  }
}

export function addVisit(c: Float64Array, v: Touch, ms: VisitMeasure, t0Filled: boolean) {
  c[TV.n]++
  for (let k = 0; k < 4; k++) {
    if (ms.race[k] === 1) c[TV.turn + k]++
    else if (ms.race[k] === 2) c[TV.brk + k]++
    if (ms.run[k] === 1) c[TV.run + k]++
    else if (ms.run[k] === 2) c[TV.fail + k]++
  }
  if (ms.brk >= 0) c[TV.hasBrk]++
  if (ms.m15 === 1) c[TV.back15]++
  else if (ms.m15 === 2) c[TV.through15]++
  if (ms.m60 === 1) c[TV.back60]++
  else if (ms.m60 === 2) c[TV.through60]++
  c[TV.howFar] += ms.howFar
  c[TV.howFarAtr] += ms.howFar / v.atr
  if (t0Filled) c[TV.t0Fill]++
  c[TV.atr] += v.atr
  if (v.endKind === 1) c[TV.endTurn]++
  else if (v.endKind === 2) c[TV.endBreak]++
}

export function addTrade(c: Float64Array, k: number, t: TradeResult, pip: number) {
  for (let e = 0; e < t.exits.length; e++) {
    const x = t.exits[e]
    const o = (k * 2 + e) * TT.size
    c[o + TT.n]++
    if (x.how === 'target') c[o + TT.target]++
    c[o + TT.after] += x.after
    c[o + TT.before] += x.before
    c[o + TT.double] += x.double
    c[o + TT.pips] += x.pnl / pip
    c[o + TT.pipsBefore] += (x.pnl + x.cost) / pip
  }
}

/** Distance from a price to a band (0 inside it). */
const bandDistance = (x: number, lo: number, hi: number) => (x < lo ? lo - x : x > hi ? x - hi : 0)

export interface TwinPlace {
  set: number
  /** 1 the lower twin (visited from below), -1 the upper twin (from above). */
  side: 1 | -1
  /** Added to the level's edges, fixed for the twin's life. */
  shift: number
  /** Edges in the first watched minute. */
  lo: number
  hi: number
  /** Left out: its nearest edge lies within 0.05 x ATR of a round number, or inside or within 0.05 x ATR of another level of its group being watched. */
  leftOut: boolean
}

/**
 * The twins of a level placed in its first watched minute ("Twins"): in set m
 * a lower twin moved down by m x ATR (if the level may be visited from below)
 * and an upper twin moved up by m x ATR (if from above), with the left-out
 * rule tested against the round numbers and the bands of `others` (the other
 * levels of the group being watched in that minute).
 */
export function placeTwins(
  grid: RoundGrid,
  lo0: number,
  hi0: number,
  sides: number,
  atr: number,
  others: [number, number][],
): TwinPlace[] {
  const out: TwinPlace[] = []
  for (const side of [1, -1] as const) {
    if ((sides & (side === 1 ? 1 : 2)) === 0) continue
    for (let set = 0; set < TWIN_SETS.length; set++) {
      const shift = -side * TWIN_SETS[set] * atr
      const lo = lo0 + shift
      const hi = hi0 + shift
      let leftOut = nearRound(grid, lo, hi, atr)
      for (let k = 0; !leftOut && k < others.length; k++) {
        const [a, b] = others[k]
        leftOut = Math.min(bandDistance(lo, a, b), bandDistance(hi, a, b)) <= 0.05 * atr + TOL
      }
      out.push({ set, side, shift, lo, hi, leftOut })
    }
  }
  return out
}

/** R00 or R50 for the round line at `units` (a multiple of the half-figure spacing). */
export const roundKind = (grid: RoundGrid, units: number): 'R00' | 'R50' =>
  units % grid.big === 0 ? 'R00' : 'R50'
