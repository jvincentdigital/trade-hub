/**
 * Our own copy of the Golden Owl, as sold and tweaked (docs/owl-copy-study.md;
 * the plan was committed and pushed before this script was run). Offline,
 * play money research.
 *
 *   tsx scripts/lab/owl-copy.ts --hist <histdata dir> --frozen <frozen 1-minute dir> --out <dir> --part a|b|choose|check [--until YYYY-MM-DD]
 *
 * a      = the Owl as sold (passive 50k file); with --until, only sessions before that day
 * b      = the entry signal on its own
 * choose = part C, choosing years only (2019 to 2022): writes choose.json
 * check  = part C, checking years (2023 to November 2026): runs once
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { OHLCCandle } from '../../src/lib/types/market'
import { loadCandleFile } from '../../src/lib/lab/load'
import { eveningOf, isWeekday, londonHoursOf, type Window } from '../../src/lib/lab/owl'
import {
  AS_SOLD,
  HORIZONS,
  averages,
  eveningMoves,
  momentsOf,
  runSession,
  type Averages,
  type CopyConfig,
} from '../../src/lib/lab/owlCopy'

const DAY = 86_400
const has = (k: string) => process.argv.includes(`--${k}`)
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${k}`)
  return process.argv[i + 1]
}
const HIST = resolve(arg('hist'))
const FROZEN = resolve(arg('frozen'))
const OUT = resolve(arg('out'))
const PART = arg('part')
const HIST_SHA = '918b9c8113a1812acc1861cb043df8b62840950c74df5a4f8457a76f09bcbcf3'
const FROM = Date.UTC(2019, 0, 1) / 1000
const SPLICE = Date.UTC(2026, 0, 1) / 1000
const TO = Date.UTC(2026, 10, 11) / 1000
const UNTIL = has('until') ? Date.parse(`${arg('until')}T00:00:00Z`) / 1000 : TO
/** Part C: choosing uses sessions before this day, checking the ones from it. */
const CHECK_FROM = Date.UTC(2023, 0, 1) / 1000
/** The checking years are read twice: up to this day (candles resolve well) and in full. */
const FAST_FROM = Date.UTC(2025, 0, 1) / 1000
const START = 50_000
/** An account under this share of its start stops trading. */
const RUIN_SHARE = 0.1
const COMMISSION = 0.07
const COSTS = {
  best: { label: 'best case ($0.20 a round trip)', spreadOf: () => 0.13 },
  typical: { label: 'typical ($0.35 a round trip)', spreadOf: () => 0.28 },
  scaled: {
    label: 'price-scaled ($0.28 spread at $1,800, growing with the price)',
    spreadOf: (first: number) => (0.28 * first) / 1800,
  },
  /** A sanity check only (added after the freeze; choosing years only): no spread and no commission. */
  free: { label: 'no costs at all', spreadOf: () => 0 },
} as const
type CostKey = keyof typeof COSTS
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]
const MIN_SHARE = 0.9
const TWINS = 20

const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')
const money = (x: number) => `${x < 0 ? '-' : '+'}$${Math.abs(x).toFixed(0)}`
const yearOf = (day: number) => new Date(day * 1000).getUTCFullYear()
const dateOf = (day: number) => new Date(day * 1000).toISOString().slice(0, 10)

interface Session {
  w: Window
  /** Candle index range in the series: from (inclusive) to (exclusive). */
  from: number
  to: number
}

function sessions(
  m1: OHLCCandle[],
  make: (day: number) => Window,
  days: readonly number[],
  first = FROM,
  last = TO,
) {
  const out: Session[] = []
  let skipped = 0
  let i = 0
  for (let day = first; day < last; day += DAY) {
    if (!isWeekday(day, days)) continue
    const w = make(day)
    if (w.to > last) continue
    while (i < m1.length && m1[i].time < w.from) i++
    let j = i
    while (j < m1.length && m1[j].time < w.to) j++
    if (j - i >= MIN_SHARE * ((w.to - w.from) / 60)) out.push({ w, from: i, to: j })
    else skipped++
  }
  return { out, skipped }
}

/** A running account: balance, worst drop (open trades included), results per year, and a snapshot at a marked day. */
class Account {
  balance = START
  peak = START
  drop = 0
  ruined: string | null = null
  sessions = 0
  stops = 0
  targets = 0
  mid: { balance: number; drop: number } | null = null
  perYear: Record<
    number,
    { n: number; stops: number; targets: number; pnl: number; start: number }
  > = {}
  alive(day: number): boolean {
    if (this.ruined) return false
    if (this.balance < RUIN_SHARE * START) {
      this.ruined = dateOf(day)
      return false
    }
    return true
  }
  add(day: number, r: { pnl: number; worst: number; stopped: boolean; targets: number }) {
    const y = yearOf(day)
    const e = (this.perYear[y] ??= { n: 0, stops: 0, targets: 0, pnl: 0, start: this.balance })
    e.n++
    e.pnl += r.pnl
    e.targets += r.targets
    this.sessions++
    this.targets += r.targets
    if (r.stopped) {
      e.stops++
      this.stops++
    }
    this.drop = Math.max(this.drop, (this.peak - (this.balance + r.worst)) / this.peak)
    this.balance += r.pnl
    this.peak = Math.max(this.peak, this.balance)
  }
}

/** Owl evenings, London hours, or the whole trading day (amendment 1). */
type Hours = 'owl' | 'london' | 'day'
const HOURS: readonly Hours[] = ['owl', 'london', 'day']
const HOURS_LABEL: Record<Hours, string> = {
  owl: 'Owl evenings',
  london: 'London hours',
  day: 'whole trading day',
}
/** The whole trading day: from the evening's start (18:05 New York) to 16:55 New York the next afternoon. */
const tradingDayOf = (day: number): Window => {
  const e = eveningOf(day)
  return { day, from: e.from, to: e.from + 1370 * 60 }
}

interface Variant {
  id: number
  hours: Hours
  gridKind: 'dollars' | 'percent'
  gridValue: number
  takeShare: number
  factor: number
  inverted: boolean
  stopPct: number
  pausePct: number
  maxTrades: number
}

function variants(): Variant[] {
  const out: Variant[] = []
  const grids: [Variant['gridKind'], number][] = [
    ['dollars', 1],
    ['dollars', 2],
    ['percent', 0.05],
    ['percent', 0.1],
    ['percent', 0.2],
  ]
  for (const hours of HOURS)
    for (const [gridKind, gridValue] of grids)
      for (const takeShare of [1, 0.5])
        for (const factor of [1, 1.357, 2])
          for (const inverted of [false, true])
            for (const [stopPct, pausePct] of [
              [4, 2],
              [2, 1],
            ])
              for (const maxTrades of [0, 8, 4])
                out.push({
                  id: out.length,
                  hours,
                  gridKind,
                  gridValue,
                  takeShare,
                  factor,
                  inverted,
                  stopPct,
                  pausePct,
                  maxTrades,
                })
  return out
}

const gridLabel = (v: Variant) =>
  v.gridKind === 'dollars' ? `$${v.gridValue.toFixed(2)}` : `${v.gridValue}% of price`
const describe = (v: Variant) =>
  [
    HOURS_LABEL[v.hours],
    `grid ${gridLabel(v)}`,
    `take ${v.takeShare === 1 ? 'one step' : 'half a step'}`,
    `factor ${v.factor}`,
    v.inverted ? 'short average inverted' : 'signal as sold',
    `stop ${v.stopPct}%`,
    v.maxTrades ? `at most ${v.maxTrades} trades a side` : 'no trade limit',
  ].join(', ')
const isAsSold = (v: Variant) =>
  v.hours === 'owl' &&
  v.gridKind === 'dollars' &&
  v.gridValue === 1 &&
  v.takeShare === 1 &&
  v.factor === 1.357 &&
  !v.inverted &&
  v.stopPct === 4 &&
  v.maxTrades === 0

function configOf(v: Variant, firstPrice: number, cost: CostKey): CopyConfig {
  const grid = v.gridKind === 'dollars' ? v.gridValue : (v.gridValue / 100) * firstPrice
  return {
    firstLot: AS_SOLD.firstLot,
    maxLot: AS_SOLD.maxLot,
    factor: v.factor,
    grid,
    take: grid * v.takeShare,
    pausePct: v.pausePct,
    stopPct: v.stopPct,
    maxTrades: v.maxTrades,
    spread: COSTS[cost].spreadOf(firstPrice),
    commission: cost === 'free' ? 0 : COMMISSION,
    hedgeFirst: 'rounded',
    afterStop: 'end',
  }
}

interface Data {
  m1: OHLCCandle[]
  avg: Averages
  owl: { out: Session[]; skipped: number }
  london: { out: Session[]; skipped: number }
  day: { out: Session[]; skipped: number }
}

/** A small seeded random number generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface RunOptions {
  /** Snapshot every account at the first session on or after this day. */
  mid?: number
  /** Reversed order inside a candle. */
  reversed?: boolean
  /** A twin: the signal moved in time inside each session, by this seed. */
  twinSeed?: number
  /**
   * The flipped study (docs/owl-mirror-study.md): the versions run as a shadow on a constant
   * paper balance and the account takes the opposite of every trade; `slip` is the extra cost
   * in dollars per ounce.
   */
  mirror?: { slip: number }
}

/** Runs every variant over the sessions of one period. */
function runAll(
  d: Data,
  vs: Variant[],
  cost: CostKey,
  from: number,
  to: number,
  o: RunOptions = {},
): Account[] {
  const acc = vs.map(() => new Account())
  for (const hours of HOURS) {
    const mine = vs.map((v, i) => ({ v, a: acc[i] })).filter((x) => x.v.hours === hours)
    if (!mine.length) continue
    let passedMid = false
    const snapshot = () => {
      passedMid = true
      for (const x of mine) x.a.mid = { balance: x.a.balance, drop: x.a.drop }
    }
    d[hours].out.forEach((s, si) => {
      if (s.w.day < from || s.w.day >= to) return
      if (o.mid !== undefined && !passedMid && s.w.day >= o.mid) snapshot()
      const m = momentsOf(d.m1, d.avg, s.from, s.to, o.reversed)
      const first = d.m1[s.from].open
      const shift =
        o.twinSeed === undefined
          ? 0
          : Math.min(
              m.n - 1,
              Math.max(1, Math.floor(m.n / 4 + random(o.twinSeed * 1_000_003 + si)() * (m.n / 2))),
            )
      for (const x of mine) {
        if (!x.a.alive(s.w.day)) continue
        const cfg = configOf(x.v, first, cost)
        if (!o.mirror) {
          x.a.add(s.w.day, runSession(m, cfg, x.a.balance, x.v.inverted, shift))
          continue
        }
        const r = runSession(m, cfg, START, x.v.inverted, shift)
        const costs = (2 * (cfg.spread + cfg.commission) + o.mirror.slip) * r.ounces
        x.a.add(s.w.day, {
          pnl: -r.pnl - costs,
          worst: Math.min(0, -r.best - costs),
          stopped: r.stopped,
          targets: r.targets,
        })
      }
    })
    if (o.mid !== undefined && !passedMid) snapshot()
  }
  return acc
}

/** Spearman rank correlation. */
function rankCorrelation(a: number[], b: number[]): number {
  const rank = (x: number[]) => {
    const order = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0])
    const r = new Array<number>(x.length)
    for (let i = 0; i < order.length; ) {
      let j = i
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2
      i = j + 1
    }
    return r
  }
  const ra = rank(a)
  const rb = rank(b)
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length
  const ma = mean(ra)
  const mb = mean(rb)
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb)
    da += (ra[i] - ma) ** 2
    db += (rb[i] - mb) ** 2
  }
  return num / Math.sqrt(da * db)
}

/** The flipped study's main check: gold 2012 to 2018, a separate file that no Owl test has touched. */
const OLD_FROM = Date.UTC(2012, 0, 1) / 1000
const OLD_TO = Date.UTC(2019, 0, 1) / 1000

async function loadOld(file: string): Promise<Data> {
  const m1 = (await loadCandleFile(file)).filter((b) => b.time >= OLD_FROM && b.time < OLD_TO)
  return {
    m1,
    avg: averages(m1),
    owl: sessions(m1, eveningOf, [1, 2, 3], OLD_FROM, OLD_TO),
    london: sessions(m1, londonHoursOf, [1, 2, 3, 4, 5], OLD_FROM, OLD_TO),
    day: sessions(m1, tradingDayOf, [0, 1, 2, 3, 4], OLD_FROM, OLD_TO),
  }
}

async function load(): Promise<Data> {
  if (has('old')) return loadOld(resolve(arg('old')))
  const histFile = join(HIST, 'XAUUSD', 'XAUUSD_1m.csv.gz')
  if (createHash('sha256').update(readFileSync(histFile)).digest('hex') !== HIST_SHA)
    throw new Error(`${histFile} is not the gold file fixed in the v1 exam`)
  const hist = await loadCandleFile(histFile)
  const frozen = await loadCandleFile(join(FROZEN, 'XAUUSD', 'XAUUSD_1m.csv.gz'))
  const m1 = [
    ...hist.filter((b) => b.time >= FROM && b.time < SPLICE),
    ...frozen.filter((b) => b.time >= SPLICE && b.time < TO),
  ]
  return {
    m1,
    avg: averages(m1),
    owl: sessions(m1, eveningOf, [1, 2, 3]),
    london: sessions(m1, londonHoursOf, [1, 2, 3, 4, 5]),
    day: sessions(m1, tradingDayOf, [0, 1, 2, 3, 4]),
  }
}

function partA(d: Data, lines: string[], results: Record<string, unknown>) {
  const runs: {
    key: string
    label: string
    cost: CostKey
    over?: Partial<CopyConfig>
    reversed?: boolean
  }[] = [
    { key: 'main-best', label: `main reading; ${COSTS.best.label}`, cost: 'best' },
    { key: 'main-typical', label: `main reading; ${COSTS.typical.label}`, cost: 'typical' },
    { key: 'main-scaled', label: `main reading; ${COSTS.scaled.label}`, cost: 'scaled' },
    {
      key: 'refused-typical',
      label: 'sensitivity: resized first trade refused; typical cost',
      cost: 'typical',
      over: { hedgeFirst: 'refused' },
    },
    {
      key: 'resume-typical',
      label: 'sensitivity: start over after a stop; typical cost',
      cost: 'typical',
      over: { afterStop: 'resume' },
    },
    {
      key: 'reversed-typical',
      label: 'sensitivity: reversed order inside a candle; typical cost',
      cost: 'typical',
      reversed: true,
    },
  ]
  const mine = d.owl.out.filter((s) => s.w.day < UNTIL)
  lines.push(
    `PART A: the Owl as sold (passive 50k file), $${START} play account, Owl evenings before ${dateOf(UNTIL)}: ${mine.length}`,
  )
  for (const run of runs) {
    const a = new Account()
    const csv = ['date,pnl,stopped,targets,trades']
    let trades = 0
    let kills = 0
    let deepest = 0
    const from = { targets: 0, stops: 0, kills: 0, end: 0 }
    for (const s of mine) {
      if (!a.alive(s.w.day)) break
      const m = momentsOf(d.m1, d.avg, s.from, s.to, run.reversed)
      const r = runSession(
        m,
        {
          ...AS_SOLD,
          spread: COSTS[run.cost].spreadOf(d.m1[s.from].open),
          commission: COMMISSION,
          ...run.over,
        },
        a.balance,
      )
      a.add(s.w.day, r)
      trades += r.trades
      kills += r.kills
      deepest = Math.max(deepest, r.deepest)
      from.targets += r.fromTargets
      from.stops += r.fromStops
      from.kills += r.fromKills
      from.end += r.fromEnd
      csv.push(
        `${dateOf(s.w.day)},${r.pnl.toFixed(4)},${r.stopped ? 1 : 0},${r.targets},${r.trades}`,
      )
    }
    lines.push(
      `${run.label}: $${START} became $${a.balance.toFixed(0)}, worst drop ${f(a.drop * 100)}%, ${trades} trades, ${a.targets} sequences closed at target, ${a.stops} evenings stopped, hidden rule fired ${kills} times, deepest pile ${deepest} trades${a.ruined ? `; ACCOUNT UNDER A TENTH OF ITS START before ${a.ruined}` : ''}`,
    )
    lines.push(
      `   where it came from: closes at a target ${money(from.targets)}, closes at the end of the evening ${money(from.end)}, stops ${money(from.stops)}, hidden rule ${money(from.kills)}`,
    )
    for (const y of YEARS) {
      const e = a.perYear[y]
      if (!e) continue
      lines.push(
        `   ${y}: ${String(e.n).padStart(3)} evenings  ${String(e.targets).padStart(5)} targets  ${String(e.stops).padStart(3)} stopped  year ${money(e.pnl)} (${f((100 * e.pnl) / e.start)}%)`,
      )
    }
    results[`A ${run.key}`] = a
    writeFileSync(
      join(OUT, `partA-${run.key}${UNTIL < TO ? '-early' : ''}.csv`),
      csv.join('\n') + '\n',
    )
  }
}

/** The mean of a list and two standard errors of that mean. */
function meanAnd2se(x: number[]): [number, number] {
  const n = x.length
  const mean = x.reduce((s, v) => s + v, 0) / n
  const sd = Math.sqrt(x.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1))
  return [mean, (2 * sd) / Math.sqrt(n)]
}

function partB(d: Data, lines: string[], results: Record<string, unknown>) {
  type Lists = { buy: number[]; sell: number[]; both: number[]; base: number[]; net: number[] }
  const lists = (): Lists => ({ buy: [], sell: [], both: [], base: [], net: [] })
  const per: Record<number, { signals: number; first: number[]; h: Lists[] }> = {}
  for (const s of d.owl.out) {
    const y = (per[yearOf(s.w.day)] ??= { signals: 0, first: [], h: HORIZONS.map(lists) })
    y.first.push(d.m1[s.from].open)
    const e = eveningMoves(d.m1, d.avg, s.from, s.to, s.w.to)
    y.signals += e.buy[0].n + e.sell[0].n
    HORIZONS.forEach((_, x) => {
      const b = e.buy[x]
      const q = e.sell[x]
      const base = e.base[x].n ? e.base[x].sum / e.base[x].n : 0
      if (e.base[x].n) y.h[x].base.push(base)
      if (b.n) y.h[x].buy.push(b.sum / b.n)
      if (q.n) y.h[x].sell.push(q.sum / q.n)
      if (b.n + q.n) {
        y.h[x].both.push((b.sum + q.sum) / (b.n + q.n))
        // With the evening's base rate taken out: buys lose it, sells gain it.
        y.h[x].net.push((b.sum - b.n * base + (q.sum + q.n * base)) / (b.n + q.n))
      }
    })
  }
  const show = (x: number[]) => {
    const [m, e] = meanAnd2se(x)
    return `${m >= 0 ? '+' : '-'}$${Math.abs(m).toFixed(3)} (${e.toFixed(3)})`
  }
  lines.push(
    'PART B: the entry signal on its own. Dollars per ounce, in the direction of the signal: average over evenings (plus or minus two standard errors).',
  )
  let pays = 0
  let differs = 0
  let years = 0
  for (const y of YEARS) {
    const e = per[y]
    if (!e) continue
    years++
    const bar = (0.35 * (e.first.reduce((s, v) => s + v, 0) / e.first.length)) / 1800
    const h15 = e.h[1]
    const [both] = meanAnd2se(h15.both)
    const [net, netErr] = meanAnd2se(h15.net)
    if (both > bar) pays++
    if (Math.abs(net) > netErr) differs++
    lines.push(
      `   ${y}: ${String(e.signals).padStart(6)} fresh signals; cost bar $${bar.toFixed(2)}; 15 min: both ${show(h15.both)}, buys ${show(h15.buy)}, sells ${show(h15.sell)}, any candle ${show(h15.base)}, both with the base rate out ${show(h15.net)}  |  5 min both ${show(e.h[0].both)}  |  60 min both ${show(e.h[2].both)}`,
    )
  }
  lines.push(
    `The reading fixed in the plan: ${pays >= 6 ? 'THE SIGNAL PAYS ITS COST OVER 15 MINUTES' : 'THE SIGNAL DOES NOT PAY ITS COST OVER 15 MINUTES'} (years with the average 15-minute move above that year's cost bar: ${pays} of ${years}); with the base rate out it differs from zero in ${differs} of ${years} years`,
  )
  results.B = per
}

function partChoose(d: Data, lines: string[], results: Record<string, unknown>) {
  const vs = variants()
  const cost: CostKey = has('cost') ? (arg('cost') as CostKey) : 'typical'
  const acc = runAll(d, vs, cost, FROM, CHECK_FROM)
  const rows = vs.map((v, i) => ({
    id: v.id,
    end: acc[i].balance,
    drop: acc[i].drop,
    score: (acc[i].balance / START - 1) / Math.max(acc[i].drop, 0.005),
  }))
  const inRows = rows.filter((r) => r.end > START && r.drop <= 0.2)
  const candidates = [...inRows]
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, 10)
    .map((r) => r.id)
  lines.push(
    `PART C, choosing years (2019 to 2022), ${COSTS[cost].label}: ${vs.length} versions; ${rows.filter((r) => r.end > START).length} ended above $${START}; ${inRows.length} did so with a worst drop of 20% or less`,
  )
  lines.push('The candidates, ranked by gain divided by worst drop:')
  candidates.forEach((id, n) => {
    const r = rows[id]
    lines.push(
      `   ${n + 1}. #${id}: ${describe(vs[id])}: $${r.end.toFixed(0)}, worst drop ${f(r.drop * 100)}%`,
    )
  })
  const sold = vs.find(isAsSold)
  if (sold) {
    const r = rows[sold.id]
    lines.push(
      `The as-sold version (#${sold.id}): $${r.end.toFixed(0)}, worst drop ${f(r.drop * 100)}%, place ${rows.filter((q) => q.end > r.end).length + 1} of ${rows.length} by end balance`,
    )
  }
  // How the versions are spread, by hours and by the two signal settings.
  const median = (x: number[]) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)]
  for (const h of HOURS)
    for (const inverted of [false, true]) {
      const mine = rows.filter((r) => vs[r.id].hours === h && vs[r.id].inverted === inverted)
      const ends = mine.map((r) => r.end)
      lines.push(
        `   ${HOURS_LABEL[h]}, ${inverted ? 'short average inverted' : 'signal as sold'}: ${mine.length} versions, ${ends.filter((e) => e > START).length} above $${START}, median end $${median(ends).toFixed(0)}, best $${Math.max(...ends).toFixed(0)}`,
      )
    }
  lines.push('The five highest end balances:')
  for (const r of [...rows].sort((a, b) => b.end - a.end).slice(0, 5))
    lines.push(
      `   #${r.id}: ${describe(vs[r.id])}: $${r.end.toFixed(0)}, worst drop ${f(r.drop * 100)}%`,
    )
  results.choose = { rows, candidates }
  writeFileSync(
    join(OUT, cost === 'typical' ? 'choose.json' : `choose-${cost}.json`),
    JSON.stringify({ rows, candidates }, null, 1),
  )
}

function partCheck(d: Data, lines: string[], results: Record<string, unknown>) {
  const marker = join(OUT, 'CHECK-DONE.json')
  if (existsSync(marker))
    throw new Error(`${marker} exists: the checking years were already examined once`)
  const chosen = JSON.parse(readFileSync(join(OUT, 'choose.json'), 'utf8')) as {
    rows: { id: number; end: number; drop: number }[]
    candidates: number[]
  }
  const vs = variants()
  writeFileSync(marker, JSON.stringify({ candidates: chosen.candidates, note: 'run once' }))
  const o = { mid: FAST_FROM }
  const all = runAll(d, vs, 'typical', CHECK_FROM, TO, o)
  const cands = chosen.candidates.map((id) => vs[id])
  const scaled = runAll(d, cands, 'scaled', CHECK_FROM, TO, o)
  const reversed = runAll(d, cands, 'typical', CHECK_FROM, TO, { ...o, reversed: true })
  const twins: Account[][] = []
  for (let seed = 1; seed <= TWINS; seed++)
    twins.push(runAll(d, cands, 'typical', CHECK_FROM, TO, { ...o, twinSeed: seed }))

  /** The two periods: 2023 to 2024 (the snapshot) and all checking years. */
  const at = (a: Account, early: boolean) =>
    early && a.mid ? a.mid : { balance: a.balance, drop: a.drop }
  const fine = (a: Account, early: boolean) => {
    const s = at(a, early)
    return s.balance >= START * 1.05 && s.drop <= 0.2
  }
  const passes = [true, false].map((early) =>
    cands.map((_, n) => {
      const mine = all[chosen.candidates[n]]
      const ahead = twins.filter((t) => at(mine, early).balance > at(t[n], early).balance).length
      return {
        ahead,
        ok: fine(mine, early) && fine(scaled[n], early) && fine(reversed[n], early) && ahead >= 19,
      }
    }),
  )
  lines.push(
    `PART C, checking years (2023 to November 2026). Each candidate starts again at $${START}. "Ahead of twins" = of ${TWINS} copies with the signal moved in time.`,
  )
  cands.forEach((v, n) => {
    const a = all[v.id]
    const early = at(a, true)
    lines.push(`   ${n + 1}. #${v.id}: ${describe(v)}`)
    lines.push(
      `        2023 to 2024: typical $${early.balance.toFixed(0)} (drop ${f(early.drop * 100)}%), price-scaled $${at(scaled[n], true).balance.toFixed(0)}, reversed order $${at(reversed[n], true).balance.toFixed(0)}, ahead of ${passes[0][n].ahead} twins: ${passes[0][n].ok ? 'PASS' : 'fail'}`,
    )
    lines.push(
      `        2023 to 2026: typical $${a.balance.toFixed(0)} (drop ${f(a.drop * 100)}%), price-scaled $${scaled[n].balance.toFixed(0)}, reversed order $${reversed[n].balance.toFixed(0)}, ahead of ${passes[1][n].ahead} twins: ${passes[1][n].ok ? 'PASS' : 'fail'}${a.ruined ? ' (ruined)' : ''}`,
    )
  })
  const p1 = passes[0].filter((p) => p.ok).length
  const p2 = passes[1].filter((p) => p.ok).length
  const both = cands.filter((_, n) => passes[0][n].ok && passes[1][n].ok)
  const steps = new Set(both.map(gridLabel)).size
  const reading =
    both.length >= 7 && steps >= 2
      ? 'A TWEAK WORTH A PLAY ACCOUNT'
      : p1 < 7 && p2 < 7
        ? 'NO TWEAK SURVIVES'
        : 'UNCLEAR: NEEDS FINER PRICE DATA'
  const ends = all.map((a) => a.balance)
  const order = (x: number[], mine: number) => x.filter((v) => v > mine).length + 1
  const sold = vs.find(isAsSold)
  lines.push(
    `All ${vs.length} versions in the checking years at the typical cost: ${all.filter((a) => fine(a, false)).length} gained at least 5% with a worst drop of 20% or less (${all.filter((a) => fine(a, true)).length} did in 2023 to 2024 alone); ${ends.filter((e) => e > START).length} ended above $${START}; median end $${[...ends].sort((a, b) => a - b)[Math.floor(ends.length / 2)].toFixed(0)}; rank correlation between choosing and checking results ${f(
      rankCorrelation(
        chosen.rows.map((r) => r.end),
        ends,
      ),
      2,
    )}`,
  )
  if (sold)
    lines.push(
      `The as-sold version (#${sold.id}) in the checking years: $${ends[sold.id].toFixed(0)}, place ${order(ends, ends[sold.id])} of ${ends.length}`,
    )
  lines.push(
    `The reading fixed in the plan: ${reading} (candidates passing 2023 to 2024: ${p1} of ${cands.length}; passing 2023 to 2026: ${p2}; passing both: ${both.length}, on ${steps} different grid steps)`,
  )
  results.check = { passes, p1, p2, both: both.map((v) => v.id), reading, ends, all }
}

const scoreOf = (a: Account) => (a.balance / START - 1) / Math.max(a.drop, 0.005)
const yearsOf = (a: Account) =>
  Object.keys(a.perYear)
    .map(Number)
    .sort((p, q) => p - q)
const yearLine = (a: Account) =>
  yearsOf(a)
    .map((y) => `${y} ${money(a.perYear[y].pnl)}`)
    .join(', ')

/** The flipped study, choosing years: every version turned upside down on 2019 to 2022. */
function partMirrorChoose(d: Data, lines: string[], results: Record<string, unknown>) {
  const vs = variants()
  const acc = runAll(d, vs, 'typical', FROM, CHECK_FROM, { mirror: { slip: 0 } })
  const rows = vs.map((v, i) => ({
    id: v.id,
    end: acc[i].balance,
    drop: acc[i].drop,
    score: scoreOf(acc[i]),
  }))
  const inRows = rows.filter((r) => r.end > START && r.drop <= 0.2)
  const candidates = [...inRows]
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, 10)
    .map((r) => r.id)
  lines.push(
    `FLIPPED, choosing years (2019 to 2022), typical cost: ${vs.length} versions; ${rows.filter((r) => r.end > START).length} ended above $${START}; ${inRows.length} did so with a worst drop of 20% or less`,
  )
  const median = (x: number[]) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)]
  for (const h of HOURS)
    for (const inverted of [false, true]) {
      const mine = rows.filter((r) => vs[r.id].hours === h && vs[r.id].inverted === inverted)
      const ends = mine.map((r) => r.end)
      lines.push(
        `   ${HOURS_LABEL[h]}, shadow with ${inverted ? 'short average inverted' : 'signal as sold'}: ${mine.length} versions, ${ends.filter((e) => e > START).length} above $${START}, median end $${median(ends).toFixed(0)}, best $${Math.max(...ends).toFixed(0)}`,
      )
    }
  lines.push('The candidates, ranked by gain divided by worst drop:')
  candidates.forEach((id, n) => {
    lines.push(
      `   ${n + 1}. #${id}: ${describe(vs[id])}: $${rows[id].end.toFixed(0)}, worst drop ${f(rows[id].drop * 100)}%; by year: ${yearLine(acc[id])}`,
    )
  })
  const sold = vs.find(isAsSold)
  if (sold) {
    lines.push(
      `The as-sold version flipped (#${sold.id}): $${rows[sold.id].end.toFixed(0)}, worst drop ${f(rows[sold.id].drop * 100)}%; by year: ${yearLine(acc[sold.id])}`,
    )
    // The shadow itself (constant paper balance), to show where both sides' money goes.
    let net = 0
    let ounces = 0
    let costs = 0
    for (const s of d.owl.out) {
      if (s.w.day < FROM || s.w.day >= CHECK_FROM) continue
      const cfg = configOf(sold, d.m1[s.from].open, 'typical')
      const r = runSession(momentsOf(d.m1, d.avg, s.from, s.to), cfg, START)
      net += r.pnl
      ounces += r.ounces
      costs += (cfg.spread + cfg.commission) * r.ounces
    }
    lines.push(
      `   its shadow over the same years: ${money(net)} after costs, on ${ounces.toFixed(0)} ounces traded; spread and commission on those ounces ${money(-costs)}; before costs ${money(net + costs)}`,
    )
  }
  results.mirrorChoose = { rows, candidates }
  writeFileSync(join(OUT, 'mirror-choose.json'), JSON.stringify({ rows, candidates }, null, 1))
}

const mirrorCandidates = () =>
  (JSON.parse(readFileSync(join(OUT, 'mirror-choose.json'), 'utf8')) as { candidates: number[] })
    .candidates

/** The flipped study, side check on years already seen: 2023 to 2024, and 2025 to 2026 for the record. */
function partMirrorSide(d: Data, lines: string[], results: Record<string, unknown>) {
  const vs = variants()
  const ids = mirrorCandidates()
  const acc = runAll(
    d,
    ids.map((id) => vs[id]),
    'typical',
    CHECK_FROM,
    TO,
    { mirror: { slip: 0 }, mid: FAST_FROM },
  )
  lines.push('FLIPPED, side check at the typical cost (not blind):')
  const side = ids.map((id, n) => {
    const a = acc[n]
    const early = (a.mid ? a.mid.balance : a.balance) - START
    lines.push(
      `   #${id}: 2023 to 2024 ${money(early)}; 2025 to 2026 ${money(a.balance - START - early)} (not used)`,
    )
    return { id, early, late: a.balance - START - early }
  })
  results.mirrorSide = side
  writeFileSync(join(OUT, 'mirror-side.json'), JSON.stringify(side, null, 1))
}

/** The flipped study, main check: the candidates on gold 2012 to 2018, run once. */
function partMirrorCheck(d: Data, lines: string[], results: Record<string, unknown>) {
  const marker = join(OUT, 'MIRROR-CHECK-DONE.json')
  if (existsSync(marker))
    throw new Error(`${marker} exists: the untouched years were already examined once`)
  const vs = variants()
  const ids = mirrorCandidates()
  const side = JSON.parse(readFileSync(join(OUT, 'mirror-side.json'), 'utf8')) as {
    id: number
    early: number
  }[]
  writeFileSync(marker, JSON.stringify({ candidates: ids, note: 'run once' }))
  const cands = ids.map((id) => vs[id])
  const run = (cost: CostKey, slip: number) =>
    runAll(d, cands, cost, OLD_FROM, OLD_TO, { mirror: { slip } })
  const typical = run('typical', 0)
  const scaled = run('scaled', 0)
  const slow = run('typical', 0.2)
  const fine = (a: Account) => a.balance >= START * 1.05 && a.drop <= 0.2
  let passed = 0
  lines.push(
    `FLIPPED, main check on gold 2012 to 2018 (never used in an Owl test). Each candidate starts at $${START}.`,
  )
  const rows = ids.map((id, n) => {
    const t = typical[n]
    const up = yearsOf(t).filter((y) => t.perYear[y].pnl > 0).length
    const early = side.find((s) => s.id === id)?.early ?? 0
    const ok = fine(t) && fine(scaled[n]) && fine(slow[n]) && up >= 5 && early >= 0
    if (ok) passed++
    lines.push(`   ${n + 1}. #${id}: ${describe(vs[id])}`)
    lines.push(
      `        typical $${t.balance.toFixed(0)} (worst drop ${f(t.drop * 100)}%), price-scaled $${scaled[n].balance.toFixed(0)}, slow hands $${slow[n].balance.toFixed(0)}; years up ${up} of ${yearsOf(t).length}; 2023 to 2024 ${money(early)}: ${ok ? 'PASS' : 'fail'}`,
    )
    lines.push(`        by year: ${yearLine(t)}`)
    return { id, typical: t, scaled: scaled[n], slow: slow[n], up, early, ok }
  })
  const need = ids.length >= 10 ? 7 : Math.max(3, Math.ceil(0.7 * ids.length))
  const reading =
    ids.length >= 3 && passed >= need
      ? 'A FLIPPED ROBOT WORTH A PLAY ACCOUNT'
      : ids.length === 0 || passed < ids.length / 2
        ? 'THE FLIP DOES NOT SURVIVE'
        : 'UNCLEAR'
  lines.push(
    `The reading fixed in the plan: ${reading} (candidates passing: ${passed} of ${ids.length}; needed ${need})`,
  )
  results.mirrorCheck = { rows, passed, need, reading }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const d = await load()
  const lines: string[] = []
  const results: Record<string, unknown> = {}
  lines.push(
    `Gold 1-minute candles: ${d.m1.length}; Owl evenings ${d.owl.out.length} (${d.owl.skipped} sat out), London sessions ${d.london.out.length} (${d.london.skipped} sat out), trading days ${d.day.out.length} (${d.day.skipped} sat out)`,
  )
  if (PART === 'a') partA(d, lines, results)
  else if (PART === 'b') partB(d, lines, results)
  else if (PART === 'choose') partChoose(d, lines, results)
  else if (PART === 'check') partCheck(d, lines, results)
  else if (PART === 'mirror-choose') partMirrorChoose(d, lines, results)
  else if (PART === 'mirror-side') partMirrorSide(d, lines, results)
  else if (PART === 'mirror-check') partMirrorCheck(d, lines, results)
  else
    throw new Error(
      '--part must be a, b, choose, check, mirror-choose, mirror-side or mirror-check',
    )
  const tag =
    PART === 'a' && UNTIL < TO
      ? '-early'
      : PART === 'choose' && has('cost')
        ? `-${arg('cost')}`
        : ''
  const name = `results-${PART}${tag}`
  const text = lines.join('\n') + '\n'
  writeFileSync(join(OUT, `${name}.txt`), text)
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(results, null, 1))
  process.stdout.write(text)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
