// "Ride the move" trend study: runner. The plan (rules, four versions, split,
// pass lines) is in docs/trend-study.md and was committed before the first
// run. Offline: reads local history files only. Play money research.
//
//   tsx scripts/lab/trend-study.ts --phase design --out <dir>
//   tsx scripts/lab/trend-study.ts --phase exam --cell <id> --out <dir>   (once)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atrSeries } from '../../src/lib/race/londonBreakout'
import { loadCandleFile, nyCloseBars } from '../../src/lib/lab/load'
import { labMarket, TF_SEC, type LabMarket } from '../../src/lib/lab/markets'
import { normalTail } from '../../src/lib/lab/stats'
import { trendTrades, type TrendTrade } from '../../src/lib/lab/trend'

const utc = (s: string) => Date.parse(s + 'T00:00:00Z') / 1000
const HOUR = 3600
const DAY = 86_400

// ── The split (docs/trend-study.md) ─────────────────────────────────────────
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

// ── The four versions ───────────────────────────────────────────────────────
const CELLS = [
  { id: 'D-20-10', tf: '1d', n: 20, x: 10 },
  { id: 'D-55-20', tf: '1d', n: 55, x: 20 },
  { id: 'H4-20-10', tf: '4h', n: 20, x: 10 },
  { id: 'H4-55-20', tf: '4h', n: 55, x: 20 },
] as const
const STOP_ATR = 2
const ATR_N = 20
const RISK = 0.01

type Row = TrendTrade & { market: string }

interface Score {
  trades: number
  avgR: number | null
  totalR: number
  winRate: number | null
  avgWinR: number | null
  profitFactor: number | null
  /** Worst drop of the account, as a share of the start, risking RISK of the start per trade. */
  worstDrop: number
  /** Most trades open at once. */
  maxOpen: number
  luckZ: number | null
  luckP: number | null
  /** Average nights a trade is held. */
  nights: number | null
  byMarket: Record<string, { trades: number; totalR: number }>
}

function score(rows: Row[]): Score {
  const n = rows.length
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const wins = rows.filter((t) => t.r > 0)
  const won = sum(wins.map((t) => t.r))
  const lost = -sum(rows.filter((t) => t.r <= 0).map((t) => t.r))
  // Account curve by exit time.
  let eq = 0
  let peak = 0
  let worstDrop = 0
  for (const t of [...rows].sort((a, b) => a.exitTime - b.exitTime)) {
    eq += t.r * RISK
    peak = Math.max(peak, eq)
    worstDrop = Math.max(worstDrop, peak - eq)
  }
  const events = rows.flatMap((t) => [
    [t.entryTime, 1],
    [t.exitTime, -1],
  ])
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let open = 0
  let maxOpen = 0
  for (const [, d] of events) maxOpen = Math.max(maxOpen, (open += d))
  // Luck: d summed per calendar month of entry, sign-flip test on the monthly sums.
  const byMonth = new Map<string, number>()
  for (const t of rows) {
    const k = new Date(t.entryTime * 1000).toISOString().slice(0, 7)
    byMonth.set(k, (byMonth.get(k) ?? 0) + t.d)
  }
  const ms = [...byMonth.values()]
  const s2 = sum(ms.map((v) => v * v))
  const luckZ = ms.length >= 6 && s2 > 0 ? sum(ms) / Math.sqrt(s2) : null
  const byMarket: Score['byMarket'] = {}
  for (const t of rows) {
    const b = (byMarket[t.market] ??= { trades: 0, totalR: 0 })
    b.trades++
    b.totalR += t.r
  }
  return {
    trades: n,
    avgR: n ? sum(rows.map((t) => t.r)) / n : null,
    totalR: sum(rows.map((t) => t.r)),
    winRate: n ? wins.length / n : null,
    avgWinR: wins.length ? won / wins.length : null,
    profitFactor: lost > 0 ? won / lost : null,
    worstDrop,
    maxOpen,
    luckZ,
    luckP: luckZ == null ? null : normalTail(luckZ),
    nights: n ? sum(rows.map((t) => t.nights)) / n : null,
    byMarket,
  }
}

const f = (v: number | null, d = 2) => (v == null ? '-' : v.toFixed(d))
const pct = (v: number | null) => (v == null ? '-' : `${(v * 100).toFixed(0)}%`)

async function main() {
  const args = process.argv.slice(2)
  const arg = (k: string) => {
    const i = args.indexOf(k)
    return i >= 0 ? args[i + 1] : undefined
  }
  const phase = arg('--phase') as 'design' | 'exam' | undefined
  const out = arg('--out')
  if ((phase !== 'design' && phase !== 'exam') || !out)
    throw new Error('usage: trend-study.ts --phase design|exam [--cell <id>] --out <dir>')
  const only = arg('--cell')
  const marker = join(out, 'EXAM-DONE.json')
  if (phase === 'exam') {
    if (!only || !CELLS.some((c) => c.id === only))
      throw new Error('the exam takes one frozen version: --cell <id>')
    if (existsSync(marker)) throw new Error(`the exam already ran (${marker}); it runs once`)
  }
  mkdirSync(out, { recursive: true })

  const dir = process.env.LAB_HISTORY ?? join(homedir(), 'jvd-outputs/trading/history-majors')
  const range = LOAD[phase]
  const periods: Record<string, readonly [number, number]> = phase === 'design' ? DESIGN : EXAM
  const cells = CELLS.filter((c) => !only || c.id === only)
  const all: Record<string, Row[]> = Object.fromEntries(cells.map((c) => [c.id, []]))
  for (const m of MARKETS) {
    const file = join(dir, m.id, `${m.id}_1h.csv.gz`)
    const h1 = (await loadCandleFile(file)).filter((b) => b.time >= range[0] && b.time < range[1])
    for (const tf of ['1d', '4h'] as const) {
      const c = nyCloseBars(h1, tf === '4h' ? 4 * HOUR : DAY)
      const atr = atrSeries(c, ATR_N)
      for (const cell of cells.filter((x) => x.tf === tf))
        for (const t of trendTrades(
          c,
          atr,
          { n: cell.n, x: cell.x, stopAtr: STOP_ATR },
          m,
          TF_SEC[tf],
        ))
          all[cell.id].push({ ...t, market: m.id })
    }
  }

  const results: Record<string, Record<string, Score>> = {}
  const lines: string[] = []
  for (const cell of cells) {
    results[cell.id] = {}
    for (const [name, [from, to]] of Object.entries(periods)) {
      const rows = all[cell.id].filter((t) => t.entryTime >= from && t.entryTime < to)
      const s = (results[cell.id][name] = score(rows))
      lines.push(
        `${cell.id.padEnd(9)} ${name.padEnd(5)} trades ${String(s.trades).padStart(4)}  avg ${f(s.avgR)}R  total ${f(s.totalR, 1)}R  won ${pct(s.winRate)}  avg win ${f(s.avgWinR)}R  PF ${f(s.profitFactor)}  drop ${pct(s.worstDrop)}  max open ${s.maxOpen}  nights ${f(s.nights, 0)}  luck z ${f(s.luckZ)} p ${f(s.luckP, 3)}`,
      )
    }
    if (phase === 'design') {
      const ps = Object.values(results[cell.id])
      const pass = ps.every((s) => s.trades >= 30 && (s.avgR ?? 0) > 0)
      const worst = Math.min(...ps.map((s) => s.avgR ?? -Infinity))
      lines.push(
        `${cell.id.padEnd(9)} design gate: ${pass ? 'PASS' : 'fail'} (worst period ${f(worst)}R)`,
      )
    } else {
      const s = results[cell.id].Exam
      const checks = {
        'at least 60 trades': s.trades >= 60,
        'average R above 0': (s.avgR ?? 0) > 0,
        'profit factor at least 1.2': (s.profitFactor ?? 0) >= 1.2,
        'luck p under 0.05': s.luckP != null && s.luckP < 0.05,
        'worst drop at most 20%': s.worstDrop <= 0.2,
      }
      for (const [k, ok] of Object.entries(checks)) lines.push(`  ${ok ? 'pass' : 'FAIL'}  ${k}`)
      lines.push(`EXAM: ${Object.values(checks).every(Boolean) ? 'PASSED' : 'FAILED'}`)
      for (const [mk, b] of Object.entries(s.byMarket))
        lines.push(`  ${mk}: ${b.trades} trades, ${f(b.totalR, 1)}R`)
    }
  }
  console.log(lines.join('\n'))
  writeFileSync(join(out, `${phase}-results.json`), JSON.stringify({ phase, results }, null, 1))
  writeFileSync(join(out, `${phase}-results.txt`), lines.join('\n') + '\n')
  if (phase === 'exam') {
    writeFileSync(join(out, `exam-trades.json`), JSON.stringify(all[only!], null, 1))
    writeFileSync(marker, JSON.stringify({ cell: only, at: new Date().toISOString() }))
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
