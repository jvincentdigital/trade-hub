// Three confirmations study: runner. The plan (rules, versions, split, pass
// lines) is in docs/confluence-study.md and was committed before the first
// run. Offline: reads local history files only. Play money research.
//
//   tsx scripts/lab/confluence-study.ts --phase design --out <dir>
//   tsx scripts/lab/confluence-study.ts --phase exam --cell <id> --out <dir>   (once)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OHLCCandle } from '../../src/lib/types/market'
import { atrSeries } from '../../src/lib/race/londonBreakout'
import { withTrend } from '../../src/lib/lab/confluence'
import { simulate, type LabEntry, type LabTrade, type SimSetup } from '../../src/lib/lab/engine'
import { planFib, type EntryMode } from '../../src/lib/lab/fibAnchors'
import { loadCandleFile, nyCloseBars } from '../../src/lib/lab/load'
import { labMarket, spreadAt, TF_SEC, type LabMarket, type LabTf } from '../../src/lib/lab/markets'
import { normalTail } from '../../src/lib/lab/stats'
import { DAY, HOUR, type Style } from '../../src/lib/lab/time'

const utc = (s: string) => Date.parse(s + 'T00:00:00Z') / 1000

// ── The split (docs/confluence-study.md) ────────────────────────────────────
const DESIGN = {
  P1: [utc('2021-04-01'), utc('2023-01-01')],
  P2: [utc('2023-01-01'), utc('2024-11-11')],
  P3: [utc('2024-11-11'), utc('2026-11-11')],
} as const
const EXAM = { Exam: [utc('2019-04-01'), utc('2021-01-01')] } as const
const LOAD = {
  design: [utc('2021-01-01'), utc('2026-11-12')],
  exam: [utc('2019-01-01'), utc('2021-04-01')],
} as const

// ── Markets and costs, as in the Fib anchor study ───────────────────────────
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

// ── The grid: 4 nested versions x 3 chart pairs, plus 2 side cells ──────────
const CHARTS = [
  { id: 'H4>H1', setup: '4h', entry: '1h', style: 'race' },
  { id: 'D>H4', setup: '1d', entry: '4h', style: 'position' },
  { id: 'H1', setup: '1h', entry: '1h', style: 'swing' },
] as const satisfies readonly { id: string; setup: LabTf; entry: LabTf; style: Style }[]
type Chart = (typeof CHARTS)[number]
const SETTING = { bars: 12, expiry: 24, k: 3 }
const VERSIONS = [
  { v: 'F', entry: 'R786', trend: null },
  { v: 'FT', entry: 'R786', trend: [12, 36] },
  { v: 'FC', entry: 'CONF2', trend: null },
  { v: 'FTC', entry: 'CONF2', trend: [12, 36] },
] as const
interface Cell {
  id: string
  v: string
  chart: Chart
  entry: EntryMode
  trend: readonly [number, number] | null
  side: boolean
}
const CELLS: Cell[] = [
  ...CHARTS.flatMap((chart) =>
    VERSIONS.map((x) => ({
      id: `${chart.id}|${x.v}`,
      v: x.v,
      chart,
      entry: x.entry as EntryMode,
      trend: x.trend,
      side: false,
    })),
  ),
  ...CHARTS.filter((c) => c.id !== 'D>H4').map((chart) => ({
    id: `${chart.id}|FTC-50-200`,
    v: 'FTC-50-200',
    chart,
    entry: 'CONF2' as EntryMode,
    trend: [50, 200] as const,
    side: true,
  })),
]
const MIN_PERIOD_TRADES = 30
const RISK = 0.01

// ── Data ────────────────────────────────────────────────────────────────────
interface Series {
  c: OHLCCandle[]
  atr: number[]
}
const cache = new Map<string, Series>()
async function loadAll(range: readonly [number, number]) {
  const dir = process.env.LAB_HISTORY ?? join(homedir(), 'jvd-outputs/trading/history-majors')
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

// ── Trades ──────────────────────────────────────────────────────────────────
interface Row {
  market: string
  entryTime: number
  exitTime: number
  r: number
  /** (real - mirrored) / 2 under the luck test's fill rule. */
  d: number
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

function rowsFor(cell: Cell, m: LabMarket): Row[] {
  const su = series(m, cell.chart.setup)
  const en = series(m, cell.chart.entry)
  const setupSec = TF_SEC[cell.chart.setup]
  let plans = planFib(su.c, en.c, {
    anchor: 'E',
    ...SETTING,
    entry: cell.entry,
    exit: 'XJ',
    setupSec,
    spreadOf: (price) => spreadAt(m, price),
    atrSetup: su.atr,
    atrEntry: en.atr,
  })
  if (cell.trend) plans = withTrend(plans, su.c, en.c, setupSec, cell.trend[0], cell.trend[1])
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
  const out: Row[] = []
  for (const p of plans) {
    const t = one(p.entry)
    if (!t) continue
    const a = one(p.entry, { limitFromNext: true })
    const b = one(flip(en.c, p.entry), { limitFromNext: true })
    out.push({
      market: m.id,
      entryTime: t.entryTime,
      exitTime: t.exitTime + TF_SEC[cell.chart.entry],
      r: t.r,
      d: a && b ? (a.r - b.r) / 2 : 0,
    })
  }
  return out
}

// ── Scoring ─────────────────────────────────────────────────────────────────
interface Score {
  trades: number
  avgR: number | null
  totalR: number
  winRate: number | null
  profitFactor: number | null
  /** Worst fall of the account from a high, as a share of the start, at RISK per trade. */
  worstDrop: number
  luckZ: number | null
  luckP: number | null
}

function score(rows: Row[]): Score {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const n = rows.length
  const won = sum(rows.filter((t) => t.r > 0).map((t) => t.r))
  const lost = -sum(rows.filter((t) => t.r <= 0).map((t) => t.r))
  let eq = 0
  let peak = 0
  let worstDrop = 0
  for (const t of [...rows].sort((a, b) => a.exitTime - b.exitTime)) {
    eq += t.r * RISK
    peak = Math.max(peak, eq)
    worstDrop = Math.max(worstDrop, peak - eq)
  }
  const months = new Map<string, number>()
  for (const t of rows) {
    const k = new Date(t.entryTime * 1000).toISOString().slice(0, 7)
    months.set(k, (months.get(k) ?? 0) + t.d)
  }
  const ms = [...months.values()]
  const s2 = sum(ms.map((v) => v * v))
  const luckZ = ms.length >= 6 && s2 > 0 ? sum(ms) / Math.sqrt(s2) : null
  return {
    trades: n,
    avgR: n ? sum(rows.map((t) => t.r)) / n : null,
    totalR: sum(rows.map((t) => t.r)),
    winRate: n ? rows.filter((t) => t.r > 0).length / n : null,
    profitFactor: lost > 0 ? won / lost : null,
    worstDrop,
    luckZ,
    luckP: luckZ == null ? null : normalTail(luckZ),
  }
}

const f = (v: number | null, d = 2) => (v == null ? '-' : v.toFixed(d))
const pct = (v: number | null) => (v == null ? '-' : `${(v * 100).toFixed(0)}%`)
const line = (id: string, name: string, s: Score) =>
  `${id.padEnd(17)} ${name.padEnd(6)} trades ${String(s.trades).padStart(4)}  avg ${f(s.avgR)}R  total ${f(s.totalR, 1).padStart(6)}R  won ${pct(s.winRate)}  PF ${f(s.profitFactor)}  drop ${pct(s.worstDrop)}  luck z ${f(s.luckZ)} p ${f(s.luckP, 3)}`

async function main() {
  const args = process.argv.slice(2)
  const arg = (k: string) => {
    const i = args.indexOf(k)
    return i >= 0 ? args[i + 1] : undefined
  }
  const phase = arg('--phase')
  const out = arg('--out')
  if ((phase !== 'design' && phase !== 'exam') || !out)
    throw new Error('usage: --phase design|exam [--cell <id>] --out <dir>')
  const only = arg('--cell')
  const marker = join(out, 'EXAM-DONE.json')
  if (phase === 'exam') {
    const cell = CELLS.find((c) => c.id === only)
    if (!cell || cell.side || cell.v === 'F')
      throw new Error('the exam takes one frozen FT, FC or FTC version: --cell <id>')
    if (existsSync(marker)) throw new Error(`the exam already ran (${marker}); it runs once`)
  }
  mkdirSync(out, { recursive: true })
  await loadAll(LOAD[phase])
  const periods: Record<string, readonly [number, number]> = phase === 'design' ? DESIGN : EXAM
  const cells = CELLS.filter((c) => !only || c.id === only)
  const lines: string[] = []
  const results: Record<string, Record<string, Score>> = {}
  const whole: Record<string, Score> = {}
  for (const cell of cells) {
    const rows = MARKETS.flatMap((m) => rowsFor(cell, m))
    const within = (from: number, to: number) =>
      rows.filter((t) => t.entryTime >= from && t.entryTime < to)
    results[cell.id] = {}
    for (const [name, [from, to]] of Object.entries(periods))
      lines.push(line(cell.id, name, (results[cell.id][name] = score(within(from, to)))))
    const all = Object.values(periods)
    whole[cell.id] = score(within(all[0][0], all[all.length - 1][1]))
    if (phase === 'design') lines.push(line(cell.id, 'all', whole[cell.id]))
  }
  if (phase === 'design') {
    lines.push('')
    const passed: { id: string; worst: number }[] = []
    for (const cell of cells.filter((c) => !c.side && c.v !== 'F')) {
      const ps = Object.values(results[cell.id])
      const base = whole[`${cell.chart.id}|F`]
      const positive = ps.every((s) => s.trades >= MIN_PERIOD_TRADES && (s.avgR ?? 0) > 0)
      const beatsF = (whole[cell.id].avgR ?? -Infinity) > (base.avgR ?? -Infinity)
      const worst = Math.min(...ps.map((s) => s.avgR ?? -Infinity))
      if (positive && beatsF) passed.push({ id: cell.id, worst })
      lines.push(
        `${cell.id.padEnd(17)} gate: ${positive && beatsF ? 'PASS' : 'fail'}  (positive in all three with 30+ trades: ${positive ? 'yes' : 'no'}; better than F: ${beatsF ? 'yes' : 'no'}; worst period ${f(worst)}R)`,
      )
    }
    passed.sort((a, b) => b.worst - a.worst)
    lines.push(
      passed.length
        ? `TO THE EXAM: ${passed[0].id}`
        : 'NO VERSION PASSED THE DESIGN GATE: no exam, the sealed years stay sealed',
    )
  } else {
    const s = results[only!].Exam
    const checks = {
      'at least 60 trades': s.trades >= 60,
      'average R above 0': (s.avgR ?? 0) > 0,
      'profit factor at least 1.2': (s.profitFactor ?? 0) >= 1.2,
      'luck p under 0.05': s.luckP != null && s.luckP < 0.05,
      'worst drop at most 20%': s.worstDrop <= 0.2,
    }
    for (const [k, ok] of Object.entries(checks)) lines.push(`  ${ok ? 'pass' : 'FAIL'}  ${k}`)
    lines.push(`EXAM: ${Object.values(checks).every(Boolean) ? 'PASSED' : 'FAILED'}`)
  }
  console.log(lines.join('\n'))
  writeFileSync(
    join(out, `${phase}-results.json`),
    JSON.stringify({ phase, results, whole }, null, 1),
  )
  writeFileSync(join(out, `${phase}-results.txt`), lines.join('\n') + '\n')
  if (phase === 'exam')
    writeFileSync(marker, JSON.stringify({ cell: only, at: new Date().toISOString() }))
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
