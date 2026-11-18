// Harmonic study (docs/harmonic-study.md, with Amendments 1 to 3): the study
// runner's arithmetic. Trade records, the 336 versions, qualification and
// ranking, Part 1 counts, the Part 2 and 3 tables, the pass lines and the
// readings, Spearman, thirds by size of R and the twins' moves. Pure: the
// runner (scripts/lab/harmonic-study.ts) does the files and the workers.

import {
  EXIT_NAMES,
  HARMONIC_MARKETS,
  LOOK_GOLD_DOLLARS,
  LOOK_HOURS,
  LOOK_PIPS,
  LOOK_R,
  weeklyT,
  type Chart,
  type EntryName,
  type HarmonicMarket,
  type How,
  type Outcome,
  type Pattern,
  type PatternName,
  type Point,
  type Trade,
  type TradeStatus,
} from './harmonic'

const DAY = 86_400
/** 00:00 UTC on 1 January of a year, in seconds. */
export const yearStart = (y: number) => Date.UTC(y, 0, 1) / 1000
export const yearOf = (t: number) => new Date(t * 1000).getUTCFullYear()

// ---------------------------------------------------------------- periods

/** [from, to): UTC seconds. */
export type Span = [number, number]

/** Period boundaries and pass numbers, shared by the real commands and the rehearsal. */
export interface StudyPeriods {
  rehearsal: boolean
  label: string
  /** Every bar at or after this is refused in a choosing run. */
  refuseFrom: number
  /** The choosing run reads no price at or after this (Amendment 1 point 6). */
  readBefore: number
  choose: Span
  halves: [Span, Span]
  check: Span
  checkYears: number[]
  twins: number
  /** Part 4: at least this many trades on all markets together, and on one market alone. */
  minTradesAll: number
  minTradesMarket: number
  /** Pass line 1 for the candidate and for the pair candidate. */
  passTrades: number
  passTradesPair: number
  /** Pass line 2. */
  minT: number
  /** Pass line 3: at least this many of the check years above zero. */
  minYears: number
  /** Pass line 4: ahead of at least this many twins; "Positive, not proven": this many. */
  minAhead: number
  positiveAhead: number
}

const years = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

export const REAL_PERIODS: StudyPeriods = {
  rehearsal: false,
  label: 'real',
  refuseFrom: yearStart(2019),
  readBefore: yearStart(2019),
  choose: [yearStart(2010), yearStart(2019)],
  halves: [
    [yearStart(2010), yearStart(2015)],
    [yearStart(2015), yearStart(2019)],
  ],
  check: [yearStart(2019), yearStart(2026)],
  checkYears: years(2019, 2025),
  twins: 200,
  minTradesAll: 300,
  minTradesMarket: 150,
  passTrades: 200,
  passTradesPair: 100,
  minT: 2.5,
  minYears: 5,
  minAhead: 190,
  positiveAhead: 100,
}

/**
 * The dress rehearsal inside the development years: choose on 2010 to 2014
 * (halves 2010 to 2012 and 2013 to 2014), check on 2015 to 2018, 20 twins.
 * The counts are scaled by the length of the spans and rounded up: trades to
 * qualify x 5/9 (167 and 84), trades to pass x 4/7 (115 and 58), 3 of 4 years
 * (5 of 7), 19 and 10 of 20 twins (190 and 100 of 200).
 */
export const REHEARSAL_PERIODS: StudyPeriods = {
  ...REAL_PERIODS,
  rehearsal: true,
  label: 'REHEARSAL',
  readBefore: yearStart(2015),
  choose: [yearStart(2010), yearStart(2015)],
  halves: [
    [yearStart(2010), yearStart(2013)],
    [yearStart(2013), yearStart(2015)],
  ],
  check: [yearStart(2015), yearStart(2019)],
  checkYears: years(2015, 2018),
  twins: 20,
  minTradesAll: 167,
  minTradesMarket: 84,
  passTrades: 115,
  passTradesPair: 58,
  minYears: 3,
  minAhead: 19,
  positiveAhead: 10,
}

export const inSpan = (t: number | null, [a, b]: Span) => t !== null && t >= a && t < b

// ---------------------------------------------------------------- trade records

/** One result of a trade or a look-back measure, as written to the trade file. */
export interface OutRec {
  how: How
  time: number
  after: number
  before: number
  double: number
  /** Market fills in 0.2-pip units (an X3 half counts 0.5). */
  slips: number
  half?: boolean
}

export interface PointRec {
  time: number
  price: number
}

export interface LookRec {
  favour: number
  against: number
  favourR: number
  againstR: number
  favourPips: number
  againstPips: number
  path: OutRec
  targetsR: OutRec[]
  targetsPips: OutRec[]
  worth: OutRec[]
}

/** One trade (any status) of one pattern and entry kind, as the runner keeps and writes it. */
export interface TradeRec {
  /** Index in its worker's list (internal). */
  uid: number
  id: string
  market: HarmonicMarket
  chart: number
  k: number
  pattern: PatternName
  dir: 1 | -1
  entry: EntryName
  status: TradeStatus
  /** C3's test (4-hour trend at the confirming candle's close agrees). */
  trend: boolean
  /** C4's test (fill minute 03:00 to 11:59 New York time). */
  hours: boolean
  x: PointRec
  a: PointRec
  b: PointRec
  c: PointRec
  /** Open and close time of the confirming chart candle. */
  confirmTime: number
  confirmClose: number
  /** Stamp of the completing minute. */
  completeTime: number
  rB: number
  rC: number
  proj: number
  d: number
  stop: number
  ofC: number
  /** C1, C2: open time of the trigger chart candle. */
  triggerTime: number | null
  fillTime: number | null
  entryPrice: number | null
  entryBid: number | null
  spread: number | null
  /** Round-trip cost: the spread, plus $0.07 for gold. */
  cost: number | null
  R: number | null
  rPips: number | null
  /** 1 for a market entry, 0 for the order at D. */
  entrySlip: number
  target1: number
  target2: number
  /** X1 to X7 (filled trades only). */
  exits: OutRec[] | null
  look: LookRec | null
}

const num = (x: number) => (Number.isFinite(x) ? x : null)
const point = (p: Point): PointRec => ({ time: p.time, price: p.price })

export function outRec(o: Outcome): OutRec {
  const r: OutRec = {
    how: o.how,
    time: o.time,
    after: o.after,
    before: o.before,
    double: o.double,
    slips: o.slips,
  }
  if (o.half !== undefined) r.half = o.half
  return r
}

/** The record of one engine trade. `chart` gives the trigger candle's time. */
export function tradeRecord(t: Trade, chart: Chart, uid: number): TradeRec {
  const p: Pattern = t.pattern
  const filled = t.status === 'filled'
  return {
    uid,
    id: `${p.market}-${p.chart}-k${p.k}-${p.id}-${t.entry}`,
    market: p.market,
    chart: p.chart,
    k: p.k,
    pattern: p.name,
    dir: p.dir,
    entry: t.entry,
    status: t.status,
    trend: t.trend,
    hours: t.hours,
    x: point(p.x),
    a: point(p.a),
    b: point(p.b),
    c: point(p.c),
    confirmTime: p.confirmTime,
    confirmClose: p.confirmClose,
    completeTime: p.wait.time,
    rB: p.rB,
    rC: p.rC,
    proj: p.proj,
    d: p.d,
    stop: p.stop,
    ofC: p.ofC,
    triggerTime: t.trigger >= 0 ? chart.time[t.trigger] : null,
    fillTime: num(t.fillTime),
    entryPrice: num(t.entryPrice),
    entryBid: num(t.entryBid),
    spread: num(t.spread),
    cost: num(t.cost),
    R: num(t.R),
    rPips: num(t.rPips),
    entrySlip: t.entrySlip,
    target1: t.target1,
    target2: t.target2,
    exits: filled ? t.exits.map(outRec) : null,
    look:
      filled && t.look
        ? {
            favour: t.look.favour,
            against: t.look.against,
            favourR: t.look.favourR,
            againstR: t.look.againstR,
            favourPips: t.look.favourPips,
            againstPips: t.look.againstPips,
            path: outRec(t.look.path),
            targetsR: t.look.targetsR.map(outRec),
            targetsPips: t.look.targetsPips.map(outRec),
            worth: t.look.worth.map(outRec),
          }
        : null,
  }
}

/** The time that places a record in a period: its fill minute, else its completing minute. */
export const periodTime = (r: TradeRec) => r.fillTime ?? r.completeTime

// ---------------------------------------------------------------- versions

export type PatternSet = 'butterfly' | 'all'
export const PATTERN_SETS: PatternSet[] = ['butterfly', 'all']
export const CHARTS = [15, 30]
export const SWING_SIZES = [2, 3]
export type VersionEntry = 'E0' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5'
export const VERSION_ENTRIES: VersionEntry[] = ['E0', 'C1', 'C2', 'C3', 'C4', 'C5']

export interface Version {
  /** Position in the tie order of Amendment 3 point 9. */
  index: number
  set: PatternSet
  chart: number
  k: number
  entry: VersionEntry
  /** 0 to 6 for X1 to X7. */
  exit: number
  key: string
}

/** Part 4's 336 versions, in the tie order: pattern set, chart, swing size, entry, exit. */
export function enumerateVersions(): Version[] {
  const out: Version[] = []
  for (const set of PATTERN_SETS)
    for (const chart of CHARTS)
      for (const k of SWING_SIZES)
        for (const entry of VERSION_ENTRIES)
          for (let exit = 0; exit < EXIT_NAMES.length; exit++)
            out.push({
              index: out.length,
              set,
              chart,
              k,
              entry,
              exit,
              key: `${set}-${chart}m-k${k}-${entry}-${EXIT_NAMES[exit]}`,
            })
  return out
}

export const VERSIONS = enumerateVersions()

/** Does a record belong to this entry version? C3 = E0 with trend, C4 = E0 with hours, C5 = C1 with trend. */
export function inEntry(r: TradeRec, e: VersionEntry): boolean {
  switch (e) {
    case 'E0':
    case 'C1':
    case 'C2':
      return r.entry === e
    case 'C3':
      return r.entry === 'E0' && r.trend
    case 'C4':
      return r.entry === 'E0' && r.hours
    case 'C5':
      return r.entry === 'C1' && r.trend
  }
}

export const inSet = (r: TradeRec, s: PatternSet) => s === 'all' || r.pattern === 'butterfly'

/** Does a record belong to a version (any status, any exit)? */
export const inVersion = (r: TradeRec, v: Omit<Version, 'index' | 'key' | 'exit'>) =>
  r.chart === v.chart && r.k === v.k && inSet(r, v.set) && inEntry(r, v.entry)

// ---------------------------------------------------------------- statistics

export interface Item {
  time: number
  after: number
  before: number
  double: number
}

/** Numbers of one list of results in R. */
export interface Stats {
  n: number
  sum: number
  mean: number
  sumBefore: number
  meanBefore: number
  sumDouble: number
  meanDouble: number
  /** Share of results above zero before costs. */
  wonBefore: number
  weeks: number
  t: number
  tBefore: number
}

export function stats(items: Item[]): Stats {
  const n = items.length
  let sum = 0
  let sb = 0
  let sd = 0
  let won = 0
  for (const x of items) {
    sum += x.after
    sb += x.before
    sd += x.double
    if (x.before > 0) won++
  }
  const wt = weeklyT(items.map((x) => ({ time: x.time, r: x.after })))
  const wb = weeklyT(items.map((x) => ({ time: x.time, r: x.before })))
  return {
    n,
    sum,
    mean: n ? sum / n : NaN,
    sumBefore: sb,
    meanBefore: n ? sb / n : NaN,
    sumDouble: sd,
    meanDouble: n ? sd / n : NaN,
    wonBefore: n ? won / n : NaN,
    weeks: wt.weeks,
    t: wt.t,
    tBefore: wb.t,
  }
}

/** Amendment 3 point 9: a year, half or market is above zero when its sum of R is; none with no trade. */
export const aboveZero = (s: { n: number; sum: number }) => s.n > 0 && s.sum > 0

/** The items of one exit of filled records. */
export const exitItems = (recs: TradeRec[], exit: number): Item[] =>
  recs.map((r) => {
    const o = r.exits![exit]
    return { time: r.fillTime!, after: o.after, before: o.before, double: o.double }
  })

export interface VersionRow {
  index: number
  key: string
  market: HarmonicMarket | 'ALL'
  /** The whole choosing span. */
  all: Stats
  halves: [Stats, Stats]
  /** Trades skipped because R was under 5 round-trip costs (fill in the span). */
  skips: number
  qualifies: boolean
}

/** Filled and skipRisk records of one market (or all), bucketed by pattern set, chart, swing size and entry. */
export function bucketKey(set: PatternSet, chart: number, k: number, e: VersionEntry) {
  return `${set}|${chart}|${k}|${e}`
}

export function bucket(recs: TradeRec[]): Map<string, TradeRec[]> {
  const m = new Map<string, TradeRec[]>()
  for (const r of recs)
    for (const set of PATTERN_SETS)
      for (const e of VERSION_ENTRIES) {
        if (!inSet(r, set) || !inEntry(r, e)) continue
        const key = bucketKey(set, r.chart, r.k, e)
        let a = m.get(key)
        if (!a) m.set(key, (a = []))
        a.push(r)
      }
  return m
}

/** Every version's numbers on records of one market (or all) over a choosing span and its halves. */
export function versionRows(
  recs: TradeRec[],
  market: HarmonicMarket | 'ALL',
  span: Span,
  halves: [Span, Span],
  minTrades: number,
): VersionRow[] {
  const inside = recs.filter((r) => inSpan(r.fillTime, span))
  const b = bucket(inside)
  return VERSIONS.map((v) => {
    const all = b.get(bucketKey(v.set, v.chart, v.k, v.entry)) ?? []
    const filled = all.filter((r) => r.status === 'filled')
    const items = exitItems(filled, v.exit)
    const s = stats(items)
    const h = halves.map((sp) => stats(items.filter((x) => inSpan(x.time, sp)))) as [Stats, Stats]
    return {
      index: v.index,
      key: v.key,
      market,
      all: s,
      halves: h,
      skips: all.filter((r) => r.status === 'skipRisk').length,
      qualifies: s.n >= minTrades && aboveZero(h[0]) && aboveZero(h[1]),
    }
  })
}

const marketOrder = (m: HarmonicMarket | 'ALL') => (m === 'ALL' ? -1 : HARMONIC_MARKETS.indexOf(m))

/**
 * Rank by weekly t-statistic, highest first. A tie goes to the version first
 * in the order of Amendment 3 point 9, then to the market first in the list
 * of markets. A t that does not exist ranks last.
 */
export function rankRows<T extends { index: number; market: HarmonicMarket | 'ALL'; all: Stats }>(
  rows: T[],
): T[] {
  const tOf = (r: T) => (Number.isNaN(r.all.t) ? -Infinity : r.all.t)
  return [...rows].sort(
    (a, b) => tOf(b) - tOf(a) || a.index - b.index || marketOrder(a.market) - marketOrder(b.market),
  )
}

/** The qualifying rows, ranked. */
export const qualifiedRanking = <T extends VersionRow>(rows: T[]) =>
  rankRows(rows.filter((r) => r.qualifies))

/** Spearman rank correlation, with average ranks for ties. NaN with fewer than 2 pairs. */
export function spearman(x: number[], y: number[]): number {
  const n = x.length
  if (n !== y.length) throw new Error('spearman: lengths differ')
  if (n < 2) return NaN
  const rx = ranks(x)
  const ry = ranks(y)
  const mx = rx.reduce((s, v) => s + v, 0) / n
  const my = ry.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my)
    sxx += (rx[i] - mx) ** 2
    syy += (ry[i] - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}

/** Ranks 1..n, ties sharing their average rank. */
export function ranks(v: number[]): number[] {
  const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(v.length)
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
    const r = (i + j) / 2 + 1
    for (let q = i; q <= j; q++) out[order[q][1]] = r
    i = j + 1
  }
  return out
}

/** Median of a list (mean of the two middle values for an even count); NaN when empty. */
export function median(v: number[]): number {
  if (!v.length) return NaN
  const s = [...v].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

const mean = (v: number[]) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN)

/**
 * Thirds by size of R (Amendment 3 point 10: R divided by the entry price),
 * smallest first. Sorted by size, then fill time; cut at floor(n/3) and
 * floor(2n/3).
 */
export function thirds<T extends { size: number; time: number }>(items: T[]): [T[], T[], T[]] {
  const s = [...items].sort((a, b) => a.size - b.size || a.time - b.time)
  const a = Math.floor(s.length / 3)
  const b = Math.floor((2 * s.length) / 3)
  return [s.slice(0, a), s.slice(a, b), s.slice(b)]
}

// ---------------------------------------------------------------- Part 1

export type Part1Pattern = PatternName | 'all'

export interface Part1Row {
  market: HarmonicMarket
  chart: number
  k: number
  year: number
  pattern: Part1Pattern
  /** Every pattern that qualified by the ratios, skipped ones included. */
  formed: number
  skipped: number
  completed: number
  cancelled_c: number
  cancelled_time: number
  cancelled_swing: number
  waiting: number
  /** Patterns whose C gave two patterns. */
  fromTwoPatternC: number
  /** Distinct C's that gave two patterns (counted on the 'all' row only; 0 on the others). */
  twoPatternCs: number
}

export const PATTERN_NAMES: PatternName[] = ['gartley', 'bat', 'butterfly', 'crab']

/** Part 1 counts of one run's patterns, by the year of the confirming candle's close (Amendment 3 point 2). */
export function part1Rows(
  patterns: Pattern[],
  keep: (year: number) => boolean = () => true,
): Part1Row[] {
  const rows = new Map<string, Part1Row>()
  const row = (p: Pattern, year: number, pattern: Part1Pattern) => {
    const key = `${year}|${pattern}`
    let r = rows.get(key)
    if (!r)
      rows.set(
        key,
        (r = {
          market: p.market,
          chart: p.chart,
          k: p.k,
          year,
          pattern,
          formed: 0,
          skipped: 0,
          completed: 0,
          cancelled_c: 0,
          cancelled_time: 0,
          cancelled_swing: 0,
          waiting: 0,
          fromTwoPatternC: 0,
          twoPatternCs: 0,
        }),
      )
    return r
  }
  const twoCs = new Set<string>()
  for (const p of patterns) {
    const year = yearOf(p.confirmClose)
    if (!keep(year)) continue
    for (const r of [row(p, year, p.name), row(p, year, 'all')]) {
      r.formed++
      r[p.wait.outcome]++
      if (p.ofC === 2) r.fromTwoPatternC++
    }
    if (p.ofC === 2 && !twoCs.has(`${year}|${p.swing}`)) {
      twoCs.add(`${year}|${p.swing}`)
      row(p, year, 'all').twoPatternCs++
    }
  }
  const order = (x: Part1Pattern) => (x === 'all' ? 4 : PATTERN_NAMES.indexOf(x))
  return [...rows.values()].sort((a, b) => a.year - b.year || order(a.pattern) - order(b.pattern))
}

// ---------------------------------------------------------------- Parts 2 and 3

export interface Spread {
  median: number
  mean: number
}

export interface TargetRow {
  label: string
  reached: number
  share: number
  meanBefore: number
  meanAfter: number
  t: number
  /** Pip targets only: the same results in pips. */
  meanBeforePips?: number
  meanAfterPips?: number
}

export interface WorthRow {
  hours: number
  /** Share above zero before costs. */
  wonBefore: number
  meanBefore: number
  meanAfter: number
  meanBeforePips: number
  meanAfterPips: number
}

export interface Sweet {
  /** Index of the row with the highest average after costs, -1 with no trade. */
  index: number
  /** False when every target is at or below zero after costs. */
  made: boolean
  text: string
}

export interface LookTable {
  trades: number
  /** R under 5 round-trip costs. */
  skips: number
  /** C entries: entry price beyond X1's target or the stop; cancelled in the wait; no trigger; data ended. */
  skipEntry: number
  cancelled: number
  noTrigger: number
  noData: number
  /** The stop came first: with only the stop and the time exit, the trade ended at its stop. */
  stopFirst: number
  stopShare: number
  favourR: Spread
  againstR: Spread
  favourPips: Spread
  againstPips: Spread
  targetsR: TargetRow[]
  sweetR: Sweet
  targetsPips: TargetRow[]
  sweetPips: Sweet
  worth: WorthRow[]
}

export const NO_SWEET_SPOT =
  'no target made money; the best row is the least-losing one, not a sweet spot'

/** The sweet spot: the target with the highest average result after costs, or the plan's fixed wording. */
export function sweetSpot(rows: { label: string; meanAfter: number }[]): Sweet {
  let index = -1
  for (let i = 0; i < rows.length; i++)
    if (
      !Number.isNaN(rows[i].meanAfter) &&
      (index < 0 || rows[i].meanAfter > rows[index].meanAfter)
    )
      index = i
  if (index < 0) return { index, made: false, text: 'no trade' }
  const made = rows[index].meanAfter > 0
  return { index, made, text: made ? `sweet spot: ${rows[index].label}` : NO_SWEET_SPOT }
}

const spreadOf = (v: number[]): Spread => ({ median: median(v), mean: mean(v) })

/** Pip target labels: pips for the pairs, dollars for gold, both when pooled. */
export function pipLabels(market: HarmonicMarket | 'ALL'): string[] {
  return LOOK_PIPS.map((p, i) =>
    market === 'XAUUSD'
      ? `$${LOOK_GOLD_DOLLARS[i]}`
      : market === 'ALL'
        ? `${p} pips (gold $${LOOK_GOLD_DOLLARS[i]})`
        : `${p} pips`,
  )
}

/**
 * One table of Parts 2 and 3 from the records of one entry version (any
 * status) whose period time is inside the span.
 */
export function lookTable(recs: TradeRec[], market: HarmonicMarket | 'ALL'): LookTable {
  const filled = recs.filter((r) => r.status === 'filled')
  const count = (s: TradeStatus) => recs.filter((r) => r.status === s).length
  const looks = filled.map((r) => r.look!)
  const stopFirst = looks.filter((l) => l.path.how === 'stop').length
  const target = (label: string, get: (r: TradeRec) => OutRec, pips: boolean): TargetRow => {
    const outs = filled.map(get)
    const reached = outs.filter((o) => o.how === 'target').length
    const items = filled.map((r, i) => ({ time: r.fillTime!, r: outs[i].after }))
    const row: TargetRow = {
      label,
      reached,
      share: filled.length ? reached / filled.length : NaN,
      meanBefore: mean(outs.map((o) => o.before)),
      meanAfter: mean(outs.map((o) => o.after)),
      t: weeklyT(items).t,
    }
    if (pips) {
      row.meanBeforePips = mean(filled.map((r, i) => outs[i].before * r.rPips!))
      row.meanAfterPips = mean(filled.map((r, i) => outs[i].after * r.rPips!))
    }
    return row
  }
  const targetsR = LOOK_R.map((x, i) => target(`${x} R`, (r) => r.look!.targetsR[i], false))
  const targetsPips = pipLabels(market).map((label, i) =>
    target(label, (r) => r.look!.targetsPips[i], true),
  )
  const worth = LOOK_HOURS.map((hours, i): WorthRow => {
    const outs = filled.map((r) => r.look!.worth[i])
    return {
      hours,
      wonBefore: outs.length ? outs.filter((o) => o.before > 0).length / outs.length : NaN,
      meanBefore: mean(outs.map((o) => o.before)),
      meanAfter: mean(outs.map((o) => o.after)),
      meanBeforePips: mean(filled.map((r, j) => outs[j].before * r.rPips!)),
      meanAfterPips: mean(filled.map((r, j) => outs[j].after * r.rPips!)),
    }
  })
  return {
    trades: filled.length,
    skips: count('skipRisk'),
    skipEntry: count('skipEntry'),
    cancelled: count('cancelled'),
    noTrigger: count('noTrigger'),
    noData: count('noData'),
    stopFirst,
    stopShare: filled.length ? stopFirst / filled.length : NaN,
    favourR: spreadOf(looks.map((l) => l.favourR)),
    againstR: spreadOf(looks.map((l) => l.againstR)),
    favourPips: spreadOf(looks.map((l) => l.favourPips)),
    againstPips: spreadOf(looks.map((l) => l.againstPips)),
    targetsR,
    sweetR: sweetSpot(targetsR),
    targetsPips,
    sweetPips: sweetSpot(targetsPips),
    worth,
  }
}

// ---------------------------------------------------------------- pass lines and readings

export interface PassFacts {
  n: number
  t: number
  /** Check years above zero. */
  yearsAbove: number
  /** Twins this one is ahead of (higher average result per trade). */
  ahead: number
  /** Sum at double cost. */
  doubleSum: number
  /** Markets above zero and markets used; null for the pair candidate (no line 6). */
  marketsAbove: number | null
  marketsUsed: number | null
}

export interface PassLine {
  line: number
  rule: string
  value: number
  ok: boolean
}

/** The six pass lines (Amendment 2 points 1 and 2): the pair candidate has no line 6 and its own trade count. */
export function passLines(f: PassFacts, minTrades: number, p: StudyPeriods): PassLine[] {
  const lines: PassLine[] = [
    { line: 1, rule: `at least ${minTrades} trades`, value: f.n, ok: f.n >= minTrades },
    { line: 2, rule: `weekly t-statistic of ${p.minT} or more`, value: f.t, ok: f.t >= p.minT },
    {
      line: 3,
      rule: `at least ${p.minYears} of the ${p.checkYears.length} years above zero`,
      value: f.yearsAbove,
      ok: f.yearsAbove >= p.minYears,
    },
    {
      line: 4,
      rule: `ahead of at least ${p.minAhead} of its ${p.twins} twins`,
      value: f.ahead,
      ok: f.ahead >= p.minAhead,
    },
    { line: 5, rule: 'still above zero at double cost', value: f.doubleSum, ok: f.doubleSum > 0 },
  ]
  if (f.marketsAbove !== null && f.marketsUsed !== null)
    lines.push({
      line: 6,
      rule: `more than half of the ${f.marketsUsed} markets used above zero`,
      value: f.marketsAbove,
      ok: f.marketsAbove * 2 > f.marketsUsed,
    })
  return lines
}

export const READINGS = [
  'Worth a play account',
  'Positive, not proven',
  'Real but too small to trade',
  'Not there',
] as const
export type Reading = (typeof READINGS)[number]

export interface ReadingFacts {
  pass: boolean
  meanAfter: number
  aheadAfter: number
  tBefore: number
  aheadBefore: number
}

/** The readings tried in the order of Amendment 2 point 5. */
export function reading(f: ReadingFacts, p: StudyPeriods): Reading {
  if (f.pass) return READINGS[0]
  if (f.meanAfter > 0 && f.aheadAfter >= p.positiveAhead) return READINGS[1]
  if (f.tBefore >= p.minT && f.aheadBefore >= p.minAhead) return READINGS[2]
  return READINGS[3]
}

/** Twins whose average is strictly below the trade's; a twin with no trade is not passed. */
export const aheadOf = (mine: number, twins: number[]) =>
  twins.filter((x) => !Number.isNaN(x) && mine > x).length

// ---------------------------------------------------------------- twins

export const TWIN_GENERATOR =
  'mulberry32 (32-bit state, seeded with the seed number 1 to N); one draw u per group of (market, UTC fill date), groups in market order then date; move = [-5,-4,-3,-2,-1,1,2,3,4,5][floor(10 u)] days'

/** mulberry32: a small fixed generator; returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const TWIN_MOVES = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5]

/** The groups of trades for the twins: one per (market, UTC date of fill), in market order then date. */
export function twinGroups(trades: { market: HarmonicMarket; fillTime: number }[]): {
  groups: string[]
  ofTrade: number[]
} {
  const keyOf = (t: { market: HarmonicMarket; fillTime: number }) =>
    [HARMONIC_MARKETS.indexOf(t.market), Math.floor(t.fillTime / DAY)] as const
  const seen = new Map<string, readonly [number, number]>()
  for (const t of trades) {
    const k = keyOf(t)
    seen.set(`${t.market}|${k[1]}`, k)
  }
  const groups = [...seen.entries()]
    .sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1])
    .map((e) => e[0])
  const at = new Map(groups.map((g, i) => [g, i]))
  return {
    groups,
    ofTrade: trades.map((t) => at.get(`${t.market}|${Math.floor(t.fillTime / DAY)}`)!),
  }
}

/** One seed's moves in days, one per group, in group order. */
export function twinMoves(seed: number, groups: number): number[] {
  const rng = mulberry32(seed)
  return Array.from({ length: groups }, () => TWIN_MOVES[Math.floor(rng() * 10)])
}

/**
 * The twin's entry stamp: the fill stamp moved by `move` days; if that minute
 * does not exist, one more day the same way, up to 4 times; else null (the
 * trade is left out).
 */
export function twinStamp(t: number, move: number, exists: (t: number) => boolean): number | null {
  const step = Math.sign(move) * DAY
  let s = t + move * DAY
  for (let i = 0; i <= 4; i++, s += step) if (exists(s)) return s
  return null
}
