// John's Fib anchor study: runner. The plan (grid, split, pass lines) is in
// docs/fib-anchor-study.md and was committed before the first run. Offline:
// reads local history files only. Play money research.
//
//   tsx scripts/lab/fib-anchor-study.ts --phase design --out <dir>
//   tsx scripts/lab/fib-anchor-study.ts --phase final  --out <dir>   (once)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OHLCCandle } from '../../src/lib/types/market'
import { atrSeries } from '../../src/lib/race/londonBreakout'
import { simulate, type LabEntry, type LabTrade, type SimSetup } from '../../src/lib/lab/engine'
import {
  ANCHORS,
  ENTRY_MODES,
  EXIT_MODES,
  planFib,
  type Anchor,
  type EntryMode,
  type ExitMode,
  type FibPlan,
} from '../../src/lib/lab/fibAnchors'
import { loadCandleFile, nyCloseBars } from '../../src/lib/lab/load'
import { labMarket, spreadAt, TF_SEC, type LabMarket, type LabTf } from '../../src/lib/lab/markets'
import { holm, normalTail } from '../../src/lib/lab/stats'
import { DAY, HOUR, type Style } from '../../src/lib/lab/time'

const utc = (s: string) => Date.parse(s + 'T00:00:00Z') / 1000

// ── The split (docs/fib-anchor-study.md) ────────────────────────────────────
const PERIODS = {
  tune: [utc('2024-11-11'), utc('2026-11-11')],
  check: [utc('2023-01-01'), utc('2024-11-11')],
  untouched: [utc('2021-04-01'), utc('2023-01-01')],
} as const
type Period = keyof typeof PERIODS
/** Candles each phase may load. Nothing before 2021-01-01 is ever read. */
const LOAD = {
  design: [utc('2022-10-01'), utc('2026-11-12')],
  final: [utc('2021-01-01'), utc('2023-02-01')],
} as const

// ── Markets: the lab's four, plus four it did not have (typical retail costs) ─
const fx = (id: string, label: string, pips: number, swap: [number, number]): LabMarket => ({
  id: id as LabMarket['id'],
  label,
  kind: 'forex',
  currencies: [id.slice(0, 3), id.slice(3)],
  spread: pips * 0.0001,
  slippage: 0.00002,
  fee: 0.000025,
  leverage: 30,
  tfs: ['1h', '4h', '1d'],
  swap,
})
const MARKETS: LabMarket[] = [
  labMarket('EURUSD'),
  labMarket('GBPUSD'),
  labMarket('USDJPY'),
  labMarket('XAUUSD'),
  fx('AUDUSD', 'AUD/USD', 0.9, [0.015, 0.01]),
  fx('USDCHF', 'USD/CHF', 1.1, [0.005, 0.04]),
  fx('USDCAD', 'USD/CAD', 1.2, [0.01, 0.02]),
  fx('NZDUSD', 'NZD/USD', 1.2, [0.015, 0.01]),
]
const JOHNS = ['GBPUSD', 'XAUUSD', 'EURUSD']

// ── The grid ────────────────────────────────────────────────────────────────
const CHARTS = [
  { id: 'H4>H1', setup: '4h', entry: '1h', style: 'race' },
  { id: 'D>H4', setup: '1d', entry: '4h', style: 'position' },
  { id: 'H1', setup: '1h', entry: '1h', style: 'swing' },
] as const satisfies readonly { id: string; setup: LabTf; entry: LabTf; style: Style }[]
type Chart = (typeof CHARTS)[number]
const SETTINGS = [
  { bars: 12, expiry: 24, k: 3 },
  { bars: 12, expiry: 24, k: 4.5 },
  { bars: 40, expiry: 60, k: 3 },
  { bars: 40, expiry: 60, k: 4.5 },
]
type Setting = (typeof SETTINGS)[number]
interface Cell {
  id: string
  chart: Chart
  anchor: Anchor
  entry: EntryMode
  exit: ExitMode
}
const CELLS: Cell[] = []
for (const chart of CHARTS) {
  const add = (anchor: Anchor, entry: EntryMode, exit: ExitMode) => {
    const id = `${chart.id}|${anchor}|${entry}|${exit}`
    if (!CELLS.some((c) => c.id === id)) CELLS.push({ id, chart, anchor, entry, exit })
  }
  for (const a of ANCHORS) add(a, 'HALVES', 'XJ')
  for (const e of ENTRY_MODES) for (const x of EXIT_MODES) add('E', e, x)
}
const MIN_TRADES = 40
const RISK = 0.02
const MAX_OPEN = 5

// ── Data ────────────────────────────────────────────────────────────────────
const dir = process.env.LAB_HISTORY ?? join(homedir(), 'jvd-outputs/trading/history-majors')
interface Series {
  c: OHLCCandle[]
  atr: number[]
}
const cache = new Map<string, Series>()
async function loadAll(range: readonly [number, number]) {
  for (const m of MARKETS) {
    const file = join(dir, m.id, `${m.id}_1h.csv.gz`)
    if (!existsSync(file)) throw new Error(`missing ${file}`)
    const h1 = (await loadCandleFile(file)).filter((b) => b.time >= range[0] && b.time < range[1])
    for (const tf of ['1h', '4h', '1d'] as const) {
      const c = tf === '1h' ? h1 : nyCloseBars(h1, tf === '4h' ? 4 * HOUR : DAY)
      cache.set(`${m.id}|${tf}`, { c, atr: atrSeries(c, 14) })
    }
  }
}
const series = (m: LabMarket, tf: LabTf) => cache.get(`${m.id}|${tf}`)!

// ── One trade per setup: real result, and real against mirrored for the luck test ─
interface Row {
  market: string
  entryTime: number
  exitTime: number
  /** R of the whole trade after costs (a half that never filled counts 0). */
  r: number
  /** (real - mirrored) / 2 under the luck test's fill rule. */
  d: number
  /** Planned stop distance of the whole trade as a share of price (margin cap). */
  stopFrac: number
  leverage: number
}

const flip = (c: OHLCCandle[], e: LabEntry): LabEntry => {
  const ref = e.kind === 'limit' && e.price != null ? e.price : c[e.i].open
  const m = (x: number) => 2 * ref - x
  return {
    ...e,
    direction: e.direction === 'long' ? 'short' : 'long',
    stop: m(e.stop),
    target: m(e.target),
    ...(e.target1 != null ? { target1: m(e.target1) } : {}),
  }
}

function rowsFor(cell: Cell, s: Setting, m: LabMarket, luck: boolean): Row[] {
  const su = series(m, cell.chart.setup)
  const en = series(m, cell.chart.entry)
  const plans = planFib(su.c, en.c, {
    anchor: cell.anchor,
    k: s.k,
    bars: s.bars,
    expiry: s.expiry,
    entry: cell.entry,
    exit: cell.exit,
    setupSec: TF_SEC[cell.chart.setup],
    spreadOf: (price) => spreadAt(m, price),
    atrSetup: su.atr,
    atrEntry: en.atr,
  })
  const setup: SimSetup = {
    market: m,
    tf: cell.chart.entry,
    style: cell.chart.style,
    news: 'off',
    windows: [],
    independent: true,
  }
  const one = (e: LabEntry, o: Partial<SimSetup> = {}): LabTrade | undefined =>
    simulate(en.c, [e], { ...setup, ...o })[0]
  const bySetup = new Map<number, FibPlan[]>()
  for (const p of plans) bySetup.set(p.setup, [...(bySetup.get(p.setup) ?? []), p])
  const out: Row[] = []
  for (const legs of bySetup.values()) {
    let r = 0
    let d = 0
    let entryTime = Infinity
    let exitTime = 0
    for (const p of legs) {
      const t = one(p.entry)
      if (!t) continue
      const w = p.dist / p.total
      r += w * t.r
      entryTime = Math.min(entryTime, t.entryTime)
      exitTime = Math.max(exitTime, t.exitTime + TF_SEC[cell.chart.entry])
      if (luck) {
        const a = one(p.entry, { limitFromNext: true })
        const b = one(flip(en.c, p.entry), { limitFromNext: true })
        if (a && b) d += (w * (a.r - b.r)) / 2
      }
    }
    if (!Number.isFinite(entryTime)) continue
    const ref = legs[0].entry.price ?? en.c[legs[0].entry.i].open
    out.push({
      market: m.id,
      entryTime,
      exitTime,
      r,
      d,
      stopFrac: legs[0].total / (cell.entry === 'HALVES' ? 2 : 1) / ref,
      leverage: m.leverage,
    })
  }
  return out.sort((a, b) => a.entryTime - b.entryTime)
}

// ── Scoring ─────────────────────────────────────────────────────────────────
interface Score {
  trades: number
  avgR: number | null
  totalR: number
  t: number | null
  winRate: number | null
  profitFactor: number | null
  maxDropPct: number
  endBalance: number
  avgWinnerPct: number | null
  /** Luck test, signals of one week summed first. */
  luckZ: number | null
  luckP: number | null
  skipped: number
}

function score(rows: Row[]): Score {
  const n = rows.length
  const totalR = rows.reduce((a, x) => a + x.r, 0)
  const mean = n ? totalR / n : null
  const sd =
    n > 1 && mean != null ? Math.sqrt(rows.reduce((a, x) => a + (x.r - mean) ** 2, 0) / (n - 1)) : 0
  // One $10,000 play account: 2% of the closed-trade balance per trade (less
  // when the stop is so close that 2% would pass the leverage cap), 5 open at most.
  let bal = 10_000
  let peak = bal
  let drop = 0
  let gw = 0
  let gl = 0
  let skipped = 0
  const wins: number[] = []
  let open: { exitTime: number; pnl: number }[] = []
  let taken = 0
  let won = 0
  const settle = (until: number) => {
    const due = open.filter((o) => o.exitTime <= until).sort((a, b) => a.exitTime - b.exitTime)
    open = open.filter((o) => o.exitTime > until)
    for (const o of due) {
      bal += o.pnl
      peak = Math.max(peak, bal)
      drop = Math.max(drop, (peak - bal) / peak)
    }
  }
  for (const x of rows) {
    settle(x.entryTime)
    if (open.length >= MAX_OPEN) {
      skipped++
      continue
    }
    const risk = Math.min(RISK, x.leverage * x.stopFrac)
    const pnl = bal * risk * x.r
    taken++
    if (pnl > 0) {
      gw += pnl
      won++
      wins.push(risk * x.r * 100)
    } else gl -= pnl
    open.push({ exitTime: x.exitTime, pnl })
  }
  settle(Infinity)
  // Luck test by week.
  const weeks = new Map<number, number>()
  for (const x of rows) {
    const w = Math.floor(x.entryTime / (7 * DAY))
    weeks.set(w, (weeks.get(w) ?? 0) + x.d)
  }
  let s1 = 0
  let s2 = 0
  for (const v of weeks.values()) {
    s1 += v
    s2 += v * v
  }
  const z = weeks.size > 1 && s2 > 0 ? s1 / Math.sqrt(s2) : null
  return {
    trades: n,
    avgR: mean,
    totalR,
    t: mean != null && sd > 0 ? mean / (sd / Math.sqrt(n)) : null,
    winRate: taken ? won / taken : null,
    profitFactor: gl > 0 ? gw / gl : null,
    maxDropPct: drop * 100,
    endBalance: bal,
    avgWinnerPct: wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null,
    luckZ: z,
    luckP: z == null ? null : normalTail(z),
    skipped,
  }
}

const inPeriod = (rows: Row[], p: Period) =>
  rows.filter((x) => x.entryTime >= PERIODS[p][0] && x.entryTime < PERIODS[p][1])
const allRows = (cell: Cell, s: Setting, luck: boolean, only?: string[]) =>
  MARKETS.filter((m) => !only || only.includes(m.id))
    .flatMap((m) => rowsFor(cell, s, m, luck))
    .sort((a, b) => a.entryTime - b.entryTime)

// ── Phases ──────────────────────────────────────────────────────────────────
interface DesignCell {
  id: string
  setting: Setting
  grid: { setting: Setting; trades: number; totalR: number }[]
  tune: Score
  check: Score
  /** Lines 1 and 2 of the pass rule. */
  gate: boolean
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const phase = arg('phase')
  const out = arg('out')
  if ((phase !== 'design' && phase !== 'final') || !out)
    throw new Error('usage: --phase design|final --out <dir>')
  mkdirSync(out, { recursive: true })
  const designFile = join(out, 'design.json')
  const finalFile = join(out, 'final.json')
  const t0 = Date.now()

  if (phase === 'design') {
    if (existsSync(finalFile))
      throw new Error('the untouched period was already scored: design is closed')
    await loadAll(LOAD.design)
    const cells: DesignCell[] = []
    for (const cell of CELLS) {
      const grid = SETTINGS.map((setting) => {
        const sc = score(inPeriod(allRows(cell, setting, false), 'tune'))
        return { setting, trades: sc.trades, totalR: sc.totalR }
      })
      const ok = grid.filter((g) => g.trades >= MIN_TRADES)
      const pick = ok.length
        ? ok.reduce((a, b) => (b.totalR > a.totalR ? b : a))
        : grid.reduce((a, b) => (b.trades > a.trades ? b : a))
      const rows = allRows(cell, pick.setting, true)
      const tune = score(inPeriod(rows, 'tune'))
      const check = score(inPeriod(rows, 'check'))
      const gate =
        tune.trades >= MIN_TRADES &&
        (tune.avgR ?? 0) > 0 &&
        check.trades >= MIN_TRADES &&
        (check.avgR ?? 0) > 0 &&
        (check.profitFactor ?? 0) > 1
      cells.push({ id: cell.id, setting: pick.setting, grid, tune, check, gate })
      console.log(
        cell.id,
        JSON.stringify(pick.setting),
        tune.trades,
        tune.avgR?.toFixed(3),
        check.trades,
        check.avgR?.toFixed(3),
        gate ? 'GATE' : '',
      )
    }
    const hs = holm(cells.map((c) => c.check.luckP))
    writeFileSync(
      designFile,
      JSON.stringify(
        { ran: new Date().toISOString(), periods: PERIODS, cells, checkHolm: hs },
        null,
        1,
      ),
    )
  } else {
    if (!existsSync(designFile)) throw new Error('run --phase design first')
    if (existsSync(finalFile))
      throw new Error('the untouched period was already scored once: refusing to run again')
    const design = JSON.parse(readFileSync(designFile, 'utf8')) as { cells: DesignCell[] }
    await loadAll(LOAD.final)
    const cells = CELLS.map((cell) => {
      const d = design.cells.find((x) => x.id === cell.id)!
      const all = score(inPeriod(allRows(cell, d.setting, true), 'untouched'))
      const johns = score(inPeriod(allRows(cell, d.setting, true, JOHNS), 'untouched'))
      console.log(
        cell.id,
        all.trades,
        all.avgR?.toFixed(3),
        all.profitFactor?.toFixed(2),
        all.luckP?.toFixed(3),
        d.gate ? 'GATE' : '',
      )
      return {
        id: cell.id,
        setting: d.setting,
        gate: d.gate,
        untouched: all,
        untouchedJohnsMarkets: johns,
      }
    })
    const gated = cells.filter((c) => c.gate)
    const gh = holm(gated.map((c) => c.untouched.luckP))
    const allHolm = holm(cells.map((c) => c.untouched.luckP))
    const survivors = gated
      .filter(
        (c, i) =>
          c.untouched.trades >= MIN_TRADES &&
          (c.untouched.avgR ?? 0) > 0 &&
          (c.untouched.profitFactor ?? 0) > 1 &&
          gh[i],
      )
      .map((c) => c.id)
    writeFileSync(
      finalFile,
      JSON.stringify(
        { ran: new Date().toISOString(), cells, survivors, holmAll: allHolm },
        null,
        1,
      ),
    )
    console.log('survivors:', survivors.length ? survivors.join(', ') : 'none')
  }
  console.log(`${phase} done in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
