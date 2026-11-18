// Levels study (docs/levels-study.md, "Counting", "What is reported", "Part 4"):
// the runner's arithmetic. The periods, the forty rules, the cells everything
// is counted from (the levels' built from their records, the twins' from the
// engine's sums), the rates shown beside a lift, the choosing bar, the pair
// candidate and its tie order, the smallest lift seen, the level and trade
// lines of the check, the readings in their order, and Part 5's correlations.
// Pure: scripts/lab/levels-study.ts does the files and the workers.

import type { HarmonicMarket } from './harmonicFind'
import { WEEK, weekStart } from './harmonicStats'
import { median, spearman, yearStart } from './harmonicStudy'
import { BOOT_DRAWS, bootstrap, gap, lift, marketLifts, type Unit } from './levelsCount'
import { TT, TT_SIZE, TV, type TwinCell, type VisitRec } from './levelsRecord'

export { median, spearman, yearStart }

const DAY = 86_400

// ---------------------------------------------------------------- order

/** The markets in the order listed under "Data and clocks". */
export const PLAN_MARKETS: HarmonicMarket[] = [
  'EURUSD',
  'GBPUSD',
  'EURGBP',
  'EURJPY',
  'USDJPY',
  'GBPJPY',
  'XAUUSD',
]

/**
 * The ten kinds in the order "The levels" lists them: round numbers (R00,
 * R50), PD, PW, Z4 and ZD, then the Fibonacci bullets, FC (F4C, FDC) before
 * FJ (F4J, FDJ).
 */
export const PLAN_KINDS = [
  'R00',
  'R50',
  'PD',
  'PW',
  'Z4',
  'ZD',
  'F4C',
  'FDC',
  'F4J',
  'FDJ',
] as const
export type PlanKind = (typeof PLAN_KINDS)[number]
/** Two-turn zones: not of the ten kinds, counted beside them against their own twins. */
export const TWO_TURN = ['Z4x2', 'ZDx2'] as const
/** Every pool a level's visits are counted in, as reported (the ten kinds, then the two-turn zones). */
export const REPORT_KINDS: string[] = [...PLAN_KINDS, ...TWO_TURN]

/** The twins' pool of a kind: the round-number grids for R00 and R50, the kind itself otherwise. */
export const twinPoolOf = (kind: string) => (kind === 'R00' || kind === 'R50' ? 'RTW' : kind)

/** Suffix of the pool that holds the levels left out of a kind because they sit on a round number. */
export const ON_ROUND = '~round'

/**
 * The pool a visit of a level is counted in, or null for a twin. A level of
 * the eight kinds that are not round numbers and sits on a round number is
 * left out of its kind ("Levels that sit on a round number"); two-turn zones
 * are not of the eight kinds and are never left out.
 */
export function levelPoolOf(v: Pick<VisitRec, 'twin' | 'kind' | 'leftOut'>): string | null {
  if (v.twin !== 'level') return null
  if (v.kind === 'Z4x2' || v.kind === 'ZDx2') return v.kind
  return v.leftOut ? v.kind + ON_ROUND : v.kind
}

// ---------------------------------------------------------------- periods

/** [from, to): UTC seconds. */
export type Span = [number, number]
export const inSpan = (t: number, [a, b]: Span) => t >= a && t < b
const years = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

/** Period boundaries, shared by the real commands and the rehearsal. */
export interface LevelPeriods {
  rehearsal: boolean
  label: string
  /** A choosing run refuses a file holding a bar stamped at or after this. */
  refuseFrom: number
  /** The choosing run reads no price at or after this; the check compares what was settled before it. */
  boundary: number
  choose: Span
  /** The two halves of the choosing years, and gold's. */
  halves: [Span, Span]
  goldHalves: [Span, Span]
  check: Span
  checkYears: number[]
  /** Part 5's blocks of the choosing run. */
  part5Choose: Span[]
}

export const REAL_PERIODS: LevelPeriods = {
  rehearsal: false,
  label: 'real',
  refuseFrom: yearStart(2019),
  boundary: yearStart(2019),
  choose: [yearStart(2005), yearStart(2019)],
  halves: [
    [yearStart(2005), yearStart(2012)],
    [yearStart(2012), yearStart(2019)],
  ],
  goldHalves: [
    [yearStart(2009), yearStart(2014)],
    [yearStart(2014), yearStart(2019)],
  ],
  check: [yearStart(2019), yearStart(2026)],
  checkYears: years(2019, 2025),
  part5Choose: [
    [yearStart(2005), yearStart(2012)],
    [yearStart(2012), yearStart(2019)],
  ],
}

/**
 * The dress rehearsal inside the development years: choose on 2005 to 2011
 * (halves 2005 to 2008 and 2009 to 2011; gold, which starts in 2009, 2009 to
 * 2010 and 2011), check on 2012 to 2018. Seven checking years, like the real
 * check, so every count and line is the real one.
 */
export const REHEARSAL_PERIODS: LevelPeriods = {
  ...REAL_PERIODS,
  rehearsal: true,
  label: 'REHEARSAL',
  boundary: yearStart(2012),
  choose: [yearStart(2005), yearStart(2012)],
  halves: [
    [yearStart(2005), yearStart(2009)],
    [yearStart(2009), yearStart(2012)],
  ],
  goldHalves: [
    [yearStart(2009), yearStart(2011)],
    [yearStart(2011), yearStart(2012)],
  ],
  check: [yearStart(2012), yearStart(2019)],
  checkYears: years(2012, 2018),
  part5Choose: [
    [yearStart(2005), yearStart(2009)],
    [yearStart(2009), yearStart(2012)],
  ],
}

export const halvesOf = (P: LevelPeriods, market: string): [Span, Span] =>
  market === 'XAUUSD' ? P.goldHalves : P.halves

/** Keep the cells of a UTC year (and market) inside a period. */
export type Keep = (market: string, year: number) => boolean
export const keepSpan =
  (s: Span): Keep =>
  (_m, y) =>
    inSpan(yearStart(y), s)
export const keepHalf =
  (P: LevelPeriods, h: 0 | 1): Keep =>
  (m, y) =>
    inSpan(yearStart(y), halvesOf(P, m)[h])

// ---------------------------------------------------------------- the forty rules

export interface RuleReading {
  name: 'Turn quick' | 'Turn hold' | 'Run quick' | 'Run hold'
  measure: 'turn' | 'run'
  /** Index into DISTANCES (0.10, 0.25, 0.50, 1.00). */
  k: number
  text: string
  /** Its trades: trade 0 T0, 1 T1, 2 B0; exit 0 quick, 1 hold. */
  trades: { trade: number; exit: number; name: string }[]
}

export const RULE_READINGS: RuleReading[] = [
  {
    name: 'Turn quick',
    measure: 'turn',
    k: 1,
    text: 'turn rate at 0.25 x ATR, 24 hours',
    trades: [
      { trade: 0, exit: 0, name: 'T0 quick' },
      { trade: 1, exit: 0, name: 'T1 quick' },
    ],
  },
  {
    name: 'Turn hold',
    measure: 'turn',
    k: 3,
    text: 'turn rate at 1.00 x ATR, 120 h',
    trades: [
      { trade: 0, exit: 1, name: 'T0 hold' },
      { trade: 1, exit: 1, name: 'T1 hold' },
    ],
  },
  {
    name: 'Run quick',
    measure: 'run',
    k: 1,
    text: 'run rate at 0.25 x ATR, 24 hours',
    trades: [{ trade: 2, exit: 0, name: 'B0 quick' }],
  },
  {
    name: 'Run hold',
    measure: 'run',
    k: 3,
    text: 'run rate at 1.00 x ATR, 120 hours',
    trades: [{ trade: 2, exit: 1, name: 'B0 hold' }],
  },
]

export interface Rule {
  index: number
  kind: PlanKind
  reading: RuleReading
  key: string
}

/** Ten kinds x four readings, kind by kind in the plan's order. */
export const RULES: Rule[] = PLAN_KINDS.flatMap((kind, i) =>
  RULE_READINGS.map((reading, j) => ({
    index: i * RULE_READINGS.length + j,
    kind,
    reading,
    key: `${kind} ${reading.name}`,
  })),
)

// ---------------------------------------------------------------- measures

/** What a rate counts on a visit cell (TV fields) or a trade cell (TT blocks). */
export interface Measure {
  hit: (v: Float64Array) => number
  den: (v: Float64Array) => number
}

/** Turn rate at distance k: turns / (turns + breaks). */
export const turnMeasure = (k: number): Measure => ({
  hit: (v) => v[TV.turn + k],
  den: (v) => v[TV.turn + k] + v[TV.brk + k],
})
/** Run rate after a break at distance k: runs / (runs + fails). */
export const runMeasure = (k: number): Measure => ({
  hit: (v) => v[TV.run + k],
  den: (v) => v[TV.run + k] + v[TV.fail + k],
})
/** Share of all visits with a field counted (back after 15 minutes, T0 filled...). */
export const shareMeasure = (field: number): Measure => ({
  hit: (v) => v[field],
  den: (v) => v[TV.n],
})
/** Share of all visits whose race at distance k was neither. */
export const neitherMeasure = (k: number): Measure => ({
  hit: (v) => v[TV.n] - v[TV.turn + k] - v[TV.brk + k],
  den: (v) => v[TV.n],
})
export const ruleMeasure = (r: RuleReading) =>
  r.measure === 'turn' ? turnMeasure(r.k) : runMeasure(r.k)

/** Offset of a (trade, exit) block in a trade cell. */
export const tradeBlock = (trade: number, exit: number) => (trade * 2 + exit) * TT.size
/** A trade's results after costs (hits are the sum of results in R, den the number of trades). */
export const tradeMeasure = (trade: number, exit: number): Measure => {
  const o = tradeBlock(trade, exit)
  return { hit: (v) => v[o + TT.after], den: (v) => v[o + TT.n] }
}

// ---------------------------------------------------------------- cells

/** A sum of visits (TV fields) or trades (TT blocks) of one market, pool, UTC year, side and counting week (or set). */
export interface Cell {
  market: string
  pool: string
  year: number
  /** 1 from below, -1 from above. */
  side: 1 | -1
  /** Counting week, or -1. */
  week: number
  /** Twin set or grid, or -1. */
  set: number
  v: Float64Array
}

export class Cells {
  private m = new Map<string, Cell>()
  constructor(private size: number) {}
  get(market: string, pool: string, year: number, side: 1 | -1, week: number, set = -1) {
    const key = `${market}|${pool}|${year}|${side}|${week}|${set}`
    let c = this.m.get(key)
    if (!c) {
      c = { market, pool, year, side, week, set, v: new Float64Array(this.size) }
      this.m.set(key, c)
    }
    return c.v
  }
  list = () => [...this.m.values()]
}

const sideNum = (s: VisitRec['side']): 1 | -1 => (s === 'below' ? 1 : -1)

/** Add one visit record to a visit cell, field by field as the engine sums a twin's visit. */
export function addVisitRec(c: Float64Array, v: VisitRec): void {
  c[TV.n]++
  for (let k = 0; k < 4; k++) {
    if (v.race[k] === 'turn') c[TV.turn + k]++
    else if (v.race[k] === 'break') c[TV.brk + k]++
    if (v.run[k] === 'run') c[TV.run + k]++
    else if (v.run[k] === 'fail') c[TV.fail + k]++
  }
  if (v.brkAt !== null) c[TV.hasBrk]++
  if (v.m15 === 'back') c[TV.back15]++
  else if (v.m15 === 'through') c[TV.through15]++
  if (v.m60 === 'back') c[TV.back60]++
  else if (v.m60 === 'through') c[TV.through60]++
  c[TV.howFar] += v.howFar
  c[TV.howFarAtr] += v.howFar / v.atr
  if (v.trades[0]?.status === 'trade') c[TV.t0Fill]++
  c[TV.atr] += v.atr
  if (v.end === 'turn') c[TV.endTurn]++
  else if (v.end === 'break') c[TV.endBreak]++
}

/** Add a visit's filled trades to trade cells by fill year and fill week, as the engine sums a twin's trades. */
export function addTradeRecs(cells: Cells, market: string, pool: string, v: VisitRec): void {
  const side = sideNum(v.side)
  v.trades.forEach((x, k) => {
    if (x.status !== 'trade' || x.year === null || x.week === null) return
    const c = cells.get(market, pool, x.year, side, x.week)
    x.exits.forEach((e, j) => {
      const o = tradeBlock(k, j)
      c[o + TT.n]++
      if (e.how === 'target') c[o + TT.target]++
      c[o + TT.after] += e.after
      c[o + TT.before] += e.before
      c[o + TT.double] += e.double
      c[o + TT.pips] += e.pips
      c[o + TT.pipsBefore] += e.pipsBefore
    })
  })
}

/** Visit cells (by touch year and week) and trade cells (by fill year and week) of one market's level visits. */
export function levelCells(
  market: string,
  visits: VisitRec[],
  poolOf: (v: VisitRec) => string | null = levelPoolOf,
): { visits: Cell[]; trades: Cell[] } {
  const cv = new Cells(TV.size)
  const ct = new Cells(TT_SIZE)
  for (const v of visits) {
    const pool = poolOf(v)
    if (pool === null) continue
    addVisitRec(cv.get(market, pool, v.year, sideNum(v.side), v.week), v)
    addTradeRecs(ct, market, pool, v)
  }
  return { visits: cv.list(), trades: ct.list() }
}

/** The engine's twin cells, with their market. */
export const twinCellsOf = (market: string, cells: TwinCell[]): Cell[] =>
  cells.map((c) => ({
    market,
    pool: c.pool,
    year: c.year,
    side: c.side,
    week: c.week,
    set: c.set,
    v: c.v,
  }))

// ---------------------------------------------------------------- units and the rates shown

/**
 * The counting units of one comparison: per counting week (or one unit per
 * cell when byWeek is false), market and cell (UTC year and side), the
 * level's hits and count and the twins'. Every cell holds at least one
 * visit, so every week that holds a visit of the levels or of their twins is
 * a unit, even when nothing in it is counted (Counting: "the counting weeks
 * that hold a visit"). dropEmpty keeps only units where something is counted
 * (the gap: "the counting weeks that hold such a trade").
 */
export function unitsOf(
  level: Cell[],
  twin: Cell[],
  m: Measure,
  keep: Keep,
  opt: { byWeek?: boolean; dropEmpty?: boolean } = {},
): Unit[] {
  const byWeek = opt.byWeek ?? true
  const map = new Map<string, Unit>()
  const unit = (c: Cell) => {
    const week = byWeek ? c.week : 0
    const key = `${c.market}|${c.year}|${c.side}|${week}`
    let u = map.get(key)
    if (!u) {
      u = {
        week,
        market: c.market,
        cell: `${c.year}|${c.side}`,
        hits: 0,
        n: 0,
        twinHits: 0,
        twinN: 0,
      }
      map.set(key, u)
    }
    return u
  }
  for (const c of level) {
    if (!keep(c.market, c.year)) continue
    const u = unit(c)
    u.hits += m.hit(c.v)
    u.n += m.den(c.v)
  }
  for (const c of twin) {
    if (!keep(c.market, c.year)) continue
    const u = unit(c)
    u.twinHits += m.hit(c.v)
    u.twinN += m.den(c.v)
  }
  const out = [...map.values()]
  return opt.dropEmpty ? out.filter((u) => u.n > 0 || u.twinN > 0) : out
}

export interface ShownMarket {
  /** Level visits counted (with a twin rate to be measured against). */
  n: number
  /** In points out of 100. */
  rate: number
  twinRate: number
  lift: number
}

export interface Shown {
  n: number
  /** The plain averages of the markets' rates and lifts (markets with a level visit counted). */
  rate: number
  twinRate: number
  lift: number
  markets: Record<string, ShownMarket>
}

/**
 * The rates shown beside a lift ("Part 2"): per market the level's rate and
 * the average of the twin rates its visits were measured against (the
 * twins' rate of each visit's UTC year and side), over the visits with a
 * twin rate; a kind's rates are the plain averages of its markets'. So the
 * two always differ by the lift.
 */
export function shownRates(units: Unit[]): Shown {
  const cells = new Map<string, { market: string; H: number; N: number; TH: number; TN: number }>()
  for (const u of units) {
    const key = `${u.market}|${u.cell}`
    let c = cells.get(key)
    if (!c) cells.set(key, (c = { market: u.market, H: 0, N: 0, TH: 0, TN: 0 }))
    c.H += u.hits
    c.N += u.n
    c.TH += u.twinHits
    c.TN += u.twinN
  }
  const acc = new Map<string, { n: number; h: number; tw: number }>()
  for (const c of cells.values()) {
    if (c.TN <= 0 || c.N <= 0) continue
    let a = acc.get(c.market)
    if (!a) acc.set(c.market, (a = { n: 0, h: 0, tw: 0 }))
    a.n += c.N
    a.h += c.H
    a.tw += (c.N * c.TH) / c.TN
  }
  const markets: Record<string, ShownMarket> = {}
  let n = 0
  let rate = 0
  let twinRate = 0
  for (const [m, a] of acc) {
    const r = (100 * a.h) / a.n
    const tr = (100 * a.tw) / a.n
    markets[m] = { n: a.n, rate: r, twinRate: tr, lift: r - tr }
    n += a.n
    rate += r
    twinRate += tr
  }
  const k = acc.size
  return {
    n,
    rate: k ? rate / k : NaN,
    twinRate: k ? twinRate / k : NaN,
    lift: k ? (rate - twinRate) / k : NaN,
    markets,
  }
}

// ---------------------------------------------------------------- a rule's numbers

export interface RuleStats {
  /** In points out of 100. */
  lift: number
  se: number
  t: number
  draws: number
  /** Each market's lift (null: no level visit counted there). */
  marketLift: Record<string, number | null>
  marketsAbove: number
  marketsUsed: number
  halves: [number, number]
  /** Level visits that ended in a turn or a break (a run or a fail). */
  decided: number
  rate: number
  twinRate: number
  /** The smallest lift this test could have seen. */
  smallest: number
}

const nn = (x: number) => (Number.isNaN(x) ? null : x)

/**
 * A lift with its t (the bootstrap of "Counting"), each market's lift, the
 * lift of each half, and the rates shown, for levels and twins over the
 * cells `keep` holds. markets: the markets used (a market with no visit is
 * not above zero). draws 0 skips the bootstrap.
 */
export function ruleStats(
  level: Cell[],
  twin: Cell[],
  m: Measure,
  keep: Keep,
  halves: [Keep, Keep],
  markets: string[],
  draws = BOOT_DRAWS,
): RuleStats {
  const units = unitsOf(level, twin, m, keep)
  const b =
    draws > 0 ? bootstrap(units, 'lift', draws) : { value: lift(units), se: NaN, t: NaN, draws: 0 }
  const ml = marketLifts(units)
  const marketLift: Record<string, number | null> = {}
  for (const mk of markets) marketLift[mk] = nn(ml.get(mk) ?? NaN)
  const marketsAbove = markets.filter((mk) => (marketLift[mk] ?? 0) > 0).length
  const half = (h: Keep) => lift(unitsOf(level, twin, m, (mk, y) => keep(mk, y) && h(mk, y)))
  let decided = 0
  for (const c of level) if (keep(c.market, c.year)) decided += m.den(c.v)
  const shown = shownRates(units)
  return {
    lift: b.value,
    se: b.se,
    t: b.t,
    draws: b.draws,
    marketLift,
    marketsAbove,
    marketsUsed: markets.length,
    halves: [half(halves[0]), half(halves[1])],
    decided,
    rate: shown.rate,
    twinRate: shown.twinRate,
    smallest: smallestSeen(b.se),
  }
}

// ---------------------------------------------------------------- choosing

export interface Line {
  line: string
  rule: string
  value: number
  ok: boolean
}

/** The choosing bar ("A rule is chosen"): its four lines. */
export function chooseBar(
  s: Pick<RuleStats, 'lift' | 'marketsAbove' | 'marketsUsed' | 'halves' | 't'>,
): Line[] {
  const used = s.marketsUsed
  const seven = used === 7
  return [
    { line: '1', rule: 'its lift is 2 points or more', value: s.lift, ok: s.lift >= 2 },
    {
      line: '2',
      rule: seven
        ? 'the lift is above zero in at least 5 of the 7 markets'
        : `the lift is above zero in more than two thirds of the ${used} markets used`,
      value: s.marketsAbove,
      ok: seven ? s.marketsAbove >= 5 : 3 * s.marketsAbove > 2 * used,
    },
    {
      line: '3',
      rule: 'the lift is above zero in each half',
      value: Math.min(s.halves[0], s.halves[1]),
      ok: s.halves[0] > 0 && s.halves[1] > 0,
    },
    { line: '4', rule: 'its t is 3.0 or more', value: s.t, ok: s.t >= 3 },
  ]
}

export const allOk = (lines: Line[]) => lines.every((l) => l.ok)

/** The pair candidate's bar for a rule on one market alone. */
export function pairBar(s: Pick<RuleStats, 'decided' | 'lift' | 'halves' | 't'>): Line[] {
  return [
    {
      line: 'a',
      rule: 'at least 150 visits that ended in a turn or a break (a run or a fail)',
      value: s.decided,
      ok: s.decided >= 150,
    },
    { line: 'b', rule: 'a lift of 4 points or more', value: s.lift, ok: s.lift >= 4 },
    {
      line: 'c',
      rule: 'a lift above zero in each half',
      value: Math.min(s.halves[0], s.halves[1]),
      ok: s.halves[0] > 0 && s.halves[1] > 0,
    },
    { line: 'd', rule: 'a t of 3.5 or more', value: s.t, ok: s.t >= 3.5 },
  ]
}

const kindOrder = (k: string) => PLAN_KINDS.indexOf(k as PlanKind)
const readingOrder = (r: string) => RULE_READINGS.findIndex((x) => x.name === r)
const marketOrder = (m: string) => (m === 'ALL' ? -1 : PLAN_MARKETS.indexOf(m as HarmonicMarket))

/**
 * Highest t first; a tie goes to the first in the order of the kinds as
 * listed, then the readings as listed, then the markets as listed under
 * "Data". A missing t comes last.
 */
export function rankByT<T extends { kind: string; reading: string; market: string; t: number }>(
  rows: T[],
): T[] {
  const tOf = (r: T) => (Number.isNaN(r.t) ? -Infinity : r.t)
  return [...rows].sort(
    (a, b) =>
      tOf(b) - tOf(a) ||
      kindOrder(a.kind) - kindOrder(b.kind) ||
      readingOrder(a.reading) - readingOrder(b.reading) ||
      marketOrder(a.market) - marketOrder(b.market),
  )
}

/** The larger of the bar (2 points) and 3.0 times the rule's standard error; NaN with no standard error. */
export const smallestSeen = (se: number) => (Number.isFinite(se) ? Math.max(2, 3 * se) : NaN)
export const notSeenText = (smallest: number) =>
  Number.isNaN(smallest)
    ? 'not seen (no standard error)'
    : `not seen at ${smallest.toFixed(1)} points or more`

export const NOTHING_CHOSEN =
  'price did not turn or run at these levels more than at nearby prices, even in the years used for choosing'

// ---------------------------------------------------------------- the check

/** The level lines L1 to L3 (the pair candidate has no L3). */
export function levelLines(
  s: Pick<RuleStats, 'lift' | 't' | 'marketsAbove' | 'marketsUsed'>,
  pair: boolean,
): Line[] {
  const lines: Line[] = [
    { line: 'L1', rule: 'a lift of 1.5 points or more', value: s.lift, ok: s.lift >= 1.5 },
    { line: 'L2', rule: 'a t of 2.0 or more', value: s.t, ok: s.t >= 2 },
  ]
  if (!pair)
    lines.push({
      line: 'L3',
      rule: 'the lift above zero in more than half of the markets used',
      value: s.marketsAbove,
      ok: 2 * s.marketsAbove > s.marketsUsed,
    })
  return lines
}

export interface TradeFacts {
  n: number
  /** Trades whose target came first. */
  target: number
  meanAfter: number
  meanBefore: number
  meanDouble: number
  meanPips: number
  meanPipsBefore: number
  /** Weekly t after costs, and its weeks. */
  weeks: number
  weeklyT: number
  /** Sum of results after costs per UTC year and per market. */
  byYear: Record<string, number>
  yearsAbove: number
  yearsCounted: number
  byMarket: Record<string, number>
  marketsAbove: number
  marketsUsed: number
  gap: number
  gapSe: number
  gapT: number
}

/** P2's bar: 2.5, or 3.0 when more than ten rule and trade pairs go to the check. */
export const p2Bar = (pairsToCheck: number) => (pairsToCheck > 10 ? 3 : 2.5)

/** The trade lines P1 to P6, after costs (the pair candidate: 100 trades and no P6). */
export function tradeLines(f: TradeFacts, pair: boolean, pairsToCheck: number): Line[] {
  const minTrades = pair ? 100 : 200
  const bar = p2Bar(pairsToCheck)
  const lines: Line[] = [
    { line: 'P1', rule: `at least ${minTrades} trades`, value: f.n, ok: f.n >= minTrades },
    {
      line: 'P2',
      rule: `a weekly t of ${bar.toFixed(1)} or more`,
      value: f.weeklyT,
      ok: f.weeklyT >= bar,
    },
    {
      line: 'P3',
      rule: `at least 5 of the ${f.yearsCounted} years above zero`,
      value: f.yearsAbove,
      ok: f.yearsAbove >= 5,
    },
    {
      line: 'P4',
      rule: 'a gap to its twins above zero, with a t of 2.0 or more',
      value: f.gapT,
      ok: f.gap > 0 && f.gapT >= 2,
    },
    {
      line: 'P5',
      rule: 'an average result above zero at double cost',
      value: f.meanDouble,
      ok: f.meanDouble > 0,
    },
  ]
  if (!pair)
    lines.push({
      line: 'P6',
      rule: 'more than half of the markets used above zero',
      value: f.marketsAbove,
      ok: 2 * f.marketsAbove > f.marketsUsed,
    })
  return lines
}

export const VERDICTS = [
  'Worth a play account',
  'Positive, not proven',
  'Real but too small to trade',
  'Not there',
] as const
export type Verdict = (typeof VERDICTS)[number]

export interface TradeVerdictFacts {
  name: string
  lines: Line[]
  meanAfter: number
  weeklyT: number
  gapT: number
}

/**
 * The readings, tried in their order: "Worth a play account" (the level lines
 * hold and a trade passes every trade line); "Positive, not proven" (they
 * hold, no trade passes, but one trade is above zero after costs with a
 * weekly t of 1.5 or more and a gap t of 1.5 or more); "Real but too small to
 * trade" (they hold); "Not there" (they do not; a trade that passes every
 * trade line all the same is named beside it).
 */
export function verdict(
  level: Line[],
  trades: TradeVerdictFacts[],
): { reading: Verdict; passing: string[]; positive: string[]; beside: string | null } {
  const levelOk = allOk(level)
  const passing = trades.filter((t) => allOk(t.lines)).map((t) => t.name)
  const positive = trades
    .filter((t) => t.meanAfter > 0 && t.weeklyT >= 1.5 && t.gapT >= 1.5)
    .map((t) => t.name)
  if (levelOk && passing.length) return { reading: VERDICTS[0], passing, positive, beside: null }
  if (levelOk && positive.length) return { reading: VERDICTS[1], passing, positive, beside: null }
  if (levelOk) return { reading: VERDICTS[2], passing, positive, beside: null }
  return {
    reading: VERDICTS[3],
    passing,
    positive,
    beside: passing.length ? `${passing.join(' and ')} passes every trade line all the same` : null,
  }
}

/**
 * "A Run rule for a kind whose Turn reading at the same distance also has a
 * lift of 2 points or more is read as 'price moves at this level', not as
 * 'breaks run'." Null when it does not apply.
 */
export function runNote(reading: RuleReading, turnLiftSameDistance: number): string | null {
  if (reading.measure !== 'run' || !(turnLiftSameDistance >= 2)) return null
  return 'read as "price moves at this level", not as "breaks run": a level that turns price also holds back its twins\' runs'
}

// ---------------------------------------------------------------- trades from cells

/** Weekly t of results after costs (weeks with no trade left out), from trade cells. */
export function weeklyTOfCells(cells: Cell[], trade: number, exit: number, keep: Keep) {
  const o = tradeBlock(trade, exit)
  const sums = new Map<number, number>()
  for (const c of cells) {
    if (!keep(c.market, c.year) || c.v[o + TT.n] <= 0) continue
    sums.set(c.week, (sums.get(c.week) ?? 0) + c.v[o + TT.after])
  }
  const v = [...sums.values()]
  const n = v.length
  if (n < 2) return { weeks: n, t: NaN }
  const mean = v.reduce((s, x) => s + x, 0) / n
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1))
  return { weeks: n, t: mean / (sd / Math.sqrt(n)) }
}

/**
 * A trade (kind of trade and exit) at the levels over the cells `keep` holds:
 * counts and averages, the weekly t, years and markets above zero, and its
 * gap to the same trade at the twins (by market, fill year and side) with
 * the bootstrap t (draws 0 skips it).
 */
export function tradeFacts(
  level: Cell[],
  twin: Cell[],
  trade: number,
  exit: number,
  keep: Keep,
  yearsList: number[],
  markets: string[],
  draws = BOOT_DRAWS,
): TradeFacts {
  const o = tradeBlock(trade, exit)
  let n = 0
  let target = 0
  let after = 0
  let before = 0
  let dbl = 0
  let pips = 0
  let pipsBefore = 0
  const byYear: Record<string, number> = {}
  const byMarket: Record<string, number> = {}
  const nYear: Record<string, number> = {}
  const nMarket: Record<string, number> = {}
  for (const c of level) {
    if (!keep(c.market, c.year)) continue
    const k = c.v[o + TT.n]
    if (k <= 0) continue
    n += k
    target += c.v[o + TT.target]
    after += c.v[o + TT.after]
    before += c.v[o + TT.before]
    dbl += c.v[o + TT.double]
    pips += c.v[o + TT.pips]
    pipsBefore += c.v[o + TT.pipsBefore]
    byYear[c.year] = (byYear[c.year] ?? 0) + c.v[o + TT.after]
    nYear[c.year] = (nYear[c.year] ?? 0) + k
    byMarket[c.market] = (byMarket[c.market] ?? 0) + c.v[o + TT.after]
    nMarket[c.market] = (nMarket[c.market] ?? 0) + k
  }
  const w = weeklyTOfCells(level, trade, exit, keep)
  const units = unitsOf(level, twin, tradeMeasure(trade, exit), keep, { dropEmpty: true })
  const g = draws > 0 ? bootstrap(units, 'gap', draws) : { value: gap(units), se: NaN, t: NaN }
  const div = (x: number) => (n ? x / n : NaN)
  return {
    n,
    target,
    meanAfter: div(after),
    meanBefore: div(before),
    meanDouble: div(dbl),
    meanPips: div(pips),
    meanPipsBefore: div(pipsBefore),
    weeks: w.weeks,
    weeklyT: w.t,
    byYear,
    yearsAbove: yearsList.filter((y) => (nYear[y] ?? 0) > 0 && byYear[y] > 0).length,
    yearsCounted: yearsList.length,
    byMarket,
    marketsAbove: markets.filter((m) => (nMarket[m] ?? 0) > 0 && byMarket[m] > 0).length,
    marketsUsed: markets.length,
    gap: g.value,
    gapSe: g.se,
    gapT: g.t,
  }
}

/**
 * How many twin sets (grids) a trade is ahead of: sets whose average result
 * after costs, over the same cells, is below the levels' (a set with no
 * trade is not passed).
 */
export function aheadOfSets(
  mean: number,
  setCells: Cell[],
  trade: number,
  exit: number,
  keep: Keep,
  sets: number,
): { ahead: number; of: number; means: number[] } {
  const o = tradeBlock(trade, exit)
  const s = new Float64Array(sets)
  const k = new Float64Array(sets)
  for (const c of setCells) {
    if (!keep(c.market, c.year) || c.set < 0 || c.set >= sets) continue
    s[c.set] += c.v[o + TT.after]
    k[c.set] += c.v[o + TT.n]
  }
  const means = Array.from(s, (x, i) => (k[i] > 0 ? x / k[i] : NaN))
  return { ahead: means.filter((x) => !Number.isNaN(x) && mean > x).length, of: sets, means }
}

/**
 * The rate of targets first needed to break even with these results: with W
 * the average result (after costs, R) of the trades whose target came first
 * and L that of the others, the share p with p W + (1 - p) L = 0. 0 when the
 * others make money on average; NaN when there is no target trade or W is
 * not above zero.
 */
export function breakEvenRate(items: { target: boolean; after: number }[]): number {
  const w = items.filter((x) => x.target)
  const l = items.filter((x) => !x.target)
  if (!w.length) return NaN
  const W = w.reduce((s, x) => s + x.after, 0) / w.length
  if (!(W > 0)) return NaN
  if (!l.length) return 0
  const L = l.reduce((s, x) => s + x.after, 0) / l.length
  if (L >= 0) return 0
  return -L / (W - L)
}

// ---------------------------------------------------------------- Part 5

/** Change in percent from each candle's close to the next existing candle's, with the two names. */
export function pctChanges(
  names: ArrayLike<number>,
  closes: ArrayLike<number>,
): { name: number; prev: number; pct: number }[] {
  const out: { name: number; prev: number; pct: number }[] = []
  for (let i = 1; i < names.length; i++)
    out.push({
      name: names[i],
      prev: names[i - 1],
      pct: (100 * (closes[i] - closes[i - 1])) / closes[i - 1],
    })
  return out
}

export function pearson(x: number[], y: number[]): number {
  const n = x.length
  if (n < 2 || n !== y.length) return NaN
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}

/**
 * Correlation of two markets' changes over candles of the same name (days
 * by the date they are named by, 4-hour candles by their block): a candle
 * counts when both markets hold it and the candle before it (so both changes
 * span the same candles); missing ones are left out.
 */
export function changeCorrelation(
  a: { name: number; prev: number; pct: number }[],
  b: { name: number; prev: number; pct: number }[],
  keep: (name: number) => boolean,
): { r: number; n: number } {
  const bm = new Map(b.map((x) => [x.name, x]))
  const x: number[] = []
  const y: number[] = []
  for (const p of a) {
    if (!keep(p.name)) continue
    const q = bm.get(p.name)
    if (!q || q.prev !== p.prev) continue
    x.push(p.pct)
    y.push(q.pct)
  }
  return { r: pearson(x, y), n: x.length }
}

/** Day names are epoch days: the UTC second of their date's midnight, for the period test. */
export const dayNameTime = (d: number) => d * DAY

// ---------------------------------------------------------------- the settled comparison

/** A counting week that ends at least 7 days before `boundary`: everything in it was settled by then. */
export const weekSettled = (week: number, boundary: number) =>
  weekStart(week * WEEK + 2 * DAY) + WEEK + 7 * DAY <= boundary

/** A visit whose every outcome, and every outcome of its trades, was settled by a minute before `boundary`. */
export const visitSettled = (v: VisitRec, boundary: number) =>
  v.done !== null &&
  v.done < boundary &&
  v.trades.every((t) => t.done !== null && t.done < boundary)

/** Numbers equal to 1e-9 (relative above 1). */
export const near9 = (a: number, b: number) =>
  a === b ||
  (Number.isNaN(a) && Number.isNaN(b)) ||
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

/** Deep equality of two records to 1e-9 on numbers. */
export function sameRec(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return near9(a, b)
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) =>
    sameRec((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  )
}

/** Which visit a record is (its edges to 1e-6, so that prices are then compared to 1e-9 as records). */
const settledKey = (v: VisitRec & { market: string }) =>
  [
    v.market,
    v.kind,
    v.twin,
    v.what,
    v.knownFrom,
    v.side,
    v.touch,
    v.near.toFixed(6),
    v.far.toFixed(6),
  ].join('|')

/**
 * Order of work point 5, for the visits and their trades: those settled
 * before `boundary` in the choosing run (`was`) and in the checking run
 * (`now`) must be the same visits with the same records.
 */
export function settledVisitDiffs<V extends VisitRec & { market: string }>(
  was: V[],
  now: V[],
  boundary: number,
): { compared: number; diffs: string[] } {
  const index = (vs: V[]) => {
    const m = new Map<string, V[]>()
    for (const v of vs) {
      if (v.touch >= boundary || !visitSettled(v, boundary)) continue
      const k = settledKey(v)
      const a = m.get(k)
      if (a) a.push(v)
      else m.set(k, [v])
    }
    return m
  }
  // Compared on everything but the level's id and the day's range, which may differ across files.
  const strip = (v: V) => {
    const { level: _l, dayRangeAtr: _d, ...rest } = v
    void _l
    void _d
    return rest
  }
  const a = index(was)
  const b = index(now)
  const diffs: string[] = []
  let compared = 0
  for (const [k, va] of a) {
    const vb = b.get(k)
    if (!vb || vb.length !== va.length) {
      diffs.push(`visit ${k}: ${va.length} in the choosing run, ${vb?.length ?? 0} now`)
      continue
    }
    va.forEach((x, i) => {
      compared++
      if (!sameRec(strip(x), strip(vb[i]))) diffs.push(`visit ${k}: records differ`)
    })
  }
  for (const k of b.keys())
    if (!a.has(k)) diffs.push(`visit ${k}: settled now, not in the choosing run`)
  return { compared, diffs }
}

/**
 * Order of work point 5, for the twin sums: the cells of counting weeks
 * settled before `boundary` must be equal in both runs, field by field
 * (`skip`: the fields a visit's end decides, which may come after the
 * boundary).
 */
export function settledCellDiffs(
  was: Cell[],
  now: Cell[],
  boundary: number,
  skip: number[],
  what: string,
): { compared: number; diffs: string[] } {
  const key = (c: Cell) => `${c.market}|${c.pool}|${c.year}|${c.side}|${c.week}|${c.set}`
  const pick = (cs: Cell[]) =>
    new Map(cs.filter((c) => weekSettled(c.week, boundary)).map((c) => [key(c), c]))
  const a = pick(was)
  const b = pick(now)
  const diffs: string[] = []
  for (const [k, c] of a) {
    const d = b.get(k)
    if (!d) {
      diffs.push(`${what} ${k}: missing now`)
      continue
    }
    for (let i = 0; i < c.v.length; i++)
      if (!skip.includes(i) && !near9(c.v[i], d.v[i])) {
        diffs.push(`${what} ${k}: field ${i} ${c.v[i]} then, ${d.v[i]} now`)
        break
      }
  }
  for (const k of b.keys()) if (!a.has(k)) diffs.push(`${what} ${k}: new now`)
  return { compared: a.size, diffs }
}
