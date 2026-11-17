/**
 * John's London v1 with the hold rule the live account uses
 * (docs/v1-hold-study.md, the plan was committed and pushed before this
 * script existed). Runs the frozen v1 first, which must reproduce the frozen
 * numbers, then the same entries with no 16:30 London exit: once with the
 * lab's overnight costs (the main result) and once without (what the
 * play-money race books). Offline, play money research, seen years only.
 *
 *   tsx scripts/lab/v1-hold.ts --history <dir with the 1-minute files> --out <dir>
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { OHLCCandle } from '../../src/lib/types/market'
import {
  CLEAN_START,
  coinRun,
  DESIGN_START,
  LONDON_MARKETS,
  londonMarket,
  mirrorTest,
  p95,
  parseFreezeRecord,
  passLines,
  prepareMarket,
  runLondon,
  summarize,
  V1,
  type LondonData,
  type LondonMarketId,
  type LondonTrade,
  type RunResult,
} from '../../src/lib/lab/johnsLondon'
import { loadCandleFile, loadNews } from '../../src/lib/lab/load'
import { swapCost } from '../../src/lib/lab/markets'
import { ismEvents } from '../../src/lib/lab/news'

const DAY = 86_400
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${k}`)
  return process.argv[i + 1]
}
const HISTORY = resolve(arg('history'))
const OUT = resolve(arg('out'))
const DESIGN_END = Date.parse('2026-11-11T00:00:00Z') / 1000
const YEARS = [
  { name: 'clean', from: CLEAN_START, to: DESIGN_START },
  { name: 'design', from: DESIGN_START, to: DESIGN_END },
] as const
/** The frozen numbers the runner must reproduce (docs/london-v1-freeze.md, docs/strategy-lab.md). */
const FROZEN = {
  clean: { trades: 97, totalR: 27.6, sha16: null as string | null },
  design: { trades: 121, totalR: 24.1, sha16: '235d582d22978d5e' },
}
type Hold = 'costs' | 'free'
const VERSIONS: { key: string; label: string; hold?: Hold }[] = [
  { key: 'frozen', label: 'frozen (16:30 London close)' },
  { key: 'hold', label: 'hold, with overnight costs', hold: 'costs' },
  { key: 'hold-free', label: 'hold, no overnight costs', hold: 'free' },
]
const f = (x: number | null, d = 2) => (x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d))
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = (xs: number[], q: number) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}
const keyOf = (t: LondonTrade) => `${t.market}|${t.entryTime}|${t.long}`

interface Row {
  run: RunResult
  s: ReturnType<typeof summarize>
  coinP95: number
  mirrorZ: number | null
  verdict: string
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  // The files must be the frozen ones.
  const rec = parseFreezeRecord(readFileSync('docs/london-v1-freeze.md', 'utf8'))
  for (const [path, fact] of Object.entries(rec.files)) {
    const local = join(HISTORY, path.split('history-1m-24mo/')[1])
    const got = createHash('sha256').update(readFileSync(local)).digest('hex')
    if (got !== fact.sha256) throw new Error(`${local} is not the frozen file (sha256 differs)`)
  }
  const m1: Record<string, OHLCCandle[]> = {}
  for (const id of LONDON_MARKETS)
    m1[id] = await loadCandleFile(join(HISTORY, id, `${id}_1m.csv.gz`))
  const newsList = await loadNews(HISTORY)

  const lines: string[] = []
  const results: Record<string, unknown> = {}
  const rows: Record<string, Record<string, Row>> = {}
  let reproduced = true

  for (const y of YEARS) {
    const news = [...newsList, ...ismEvents(y.from - 30 * DAY, y.to + DAY)]
    const data: LondonData[] = LONDON_MARKETS.map((id) =>
      prepareMarket(
        id,
        m1[id].filter((b) => b.time >= y.from && b.time < y.to),
        news,
      ),
    )
    const byId = new Map<LondonMarketId, LondonData>(data.map((d) => [d.id, d]))
    rows[y.name] = {}
    lines.push(`\n══ ${y.name} year`)
    for (const v of VERSIONS) {
      const run = runLondon(
        data,
        { k: 2, b: 0.5, ...(v.hold ? { hold: v.hold } : {}) },
        y.from,
        y.to,
      )
      const s = summarize(run.trades)
      const mirror = mirrorTest(run.trades, byId, v.hold)
      const coins: number[] = []
      for (let seed = 1; seed <= 1000; seed++)
        coins.push(coinRun(run.trades, byId, seed, v.hold).total)
      const coinP95 = p95(coins)
      const pass = passLines({
        trades: s.trades,
        endBalance: run.endBalance,
        start: V1.startMoney,
        avgR: s.avgR,
        profitFactor: s.profitFactor,
        maxDrawdown: run.maxDrawdown,
        totalR: s.totalR,
        coinP95,
        mirrorZ: mirror.z,
      })
      rows[y.name][v.key] = { run, s, coinP95, mirrorZ: mirror.z, verdict: pass.verdict }

      // How each trade ended, and how long it was held.
      const ends: Record<string, { n: number; r: number; wins: number }> = {}
      for (const t of run.trades) {
        const e = (ends[t.why] ??= { n: 0, r: 0, wins: 0 })
        e.n++
        e.r += t.r
        if (t.r > 0) e.wins++
      }
      const hours = run.trades.map((t) => (t.exitTime - t.entryTime) / 3600)
      const nights = run.trades.map(
        (t) => swapCost(londonMarket(t.market), t.long, t.entryTime, t.exitTime, t.E).nights,
      )
      const blocked = run.outcomes.filter((o) => o.result === 'trade open').length
      const per = Object.fromEntries(
        LONDON_MARKETS.map((m) => {
          const x = summarize(run.trades.filter((t) => t.market === m))
          return [m, { trades: x.trades, totalR: x.totalR }]
        }),
      )

      // A held trade must keep its market busy: no two trades of one market may overlap.
      if (v.hold)
        for (const id of LONDON_MARKETS) {
          const ts = run.trades
            .filter((t) => t.market === id)
            .sort((a, b) => a.entryTime - b.entryTime)
          for (let i = 1; i < ts.length; i++)
            if (ts[i].entryTime < ts[i - 1].exitTime)
              throw new Error(`${y.name} ${v.key}: two ${id} trades overlap (${ts[i].day})`)
        }

      results[`${y.name} ${v.key}`] = {
        summary: s,
        endBalance: run.endBalance,
        maxDrawdown: run.maxDrawdown,
        maxOpenSeen: run.maxOpenSeen,
        signals: run.signals,
        blockedByOpenTrade: blocked,
        mirror,
        coinP95,
        pass,
        per,
        ends,
        heldHours: { median: pct(hours, 0.5), p90: pct(hours, 0.9), max: Math.max(...hours) },
        nights: { total: sum(nights), tradesOverNight: nights.filter((n) => n > 0).length },
      }
      lines.push(
        `${v.label.padEnd(28)} trades ${String(s.trades).padStart(3)}  total ${f(s.totalR, 1).padStart(6)}R  avg ${f(s.avgR)}R  won ${f(s.winRate * 100, 0)}%  PF ${f(s.profitFactor)}  $${run.endBalance.toFixed(0)}  drop ${f(run.maxDrawdown * 100, 1)}%  coin p95 ${f(coinP95, 1)}R  mirror z ${f(mirror.z)}  six lines: ${pass.verdict}`,
      )
      lines.push(
        `   ended: ${Object.entries(ends)
          .sort((a, b) => b[1].n - a[1].n)
          .map(([w, e]) => `${w} ${e.n} (${f(e.r, 1)}R, ${e.wins} won)`)
          .join('; ')}`,
      )
      lines.push(
        `   held: median ${f(pct(hours, 0.5), 1)} h, 9 in 10 under ${f(pct(hours, 0.9), 1)} h, longest ${f(Math.max(...hours), 1)} h; ${nights.filter((n) => n > 0).length} trades over at least one night (${sum(nights)} nights${v.hold === 'costs' ? ' charged' : v.hold ? ', not charged' : ''}); signals passed because a trade was open: ${blocked}; most open at once: ${run.maxOpenSeen}; ${Object.entries(
          per,
        )
          .map(([m, x]) => `${m} ${x.trades}/${f(x.totalR, 1)}R`)
          .join(' ')}`,
      )
      if (!v.hold) {
        const want = FROZEN[y.name]
        const sha16 = createHash('sha256')
          .update(JSON.stringify(run.trades))
          .digest('hex')
          .slice(0, 16)
        const ok =
          s.trades === want.trades &&
          Math.abs(s.totalR - want.totalR) < 0.06 &&
          (want.sha16 == null || want.sha16 === sha16)
        lines.push(
          `   reproduces the frozen run (${want.trades} trades, ${want.totalR}R${want.sha16 ? `, trade list ${want.sha16}` : ''}): ${ok ? 'yes' : 'NO'} (trade list ${sha16})`,
        )
        reproduced &&= ok
      }
      writeFileSync(
        join(OUT, `trades-${v.key}-${y.name}.json`),
        JSON.stringify(run.trades, null, 1),
      )
    }

    // The paired view: what the hold rule did to the trades the clock used to close.
    const frozen = rows[y.name].frozen.run.trades
    const held = new Map(rows[y.name].hold.run.trades.map((t) => [keyOf(t), t]))
    const frozenKeys = new Set(frozen.map(keyOf))
    const clock = frozen.filter((t) => t.why === 'time')
    const pairs = clock.map((t) => ({ a: t, b: held.get(keyOf(t)) }))
    const both = pairs.filter((p) => p.b)
    const how: Record<string, { n: number; r: number }> = {}
    for (const p of both) {
      const e = (how[p.b!.why] ??= { n: 0, r: 0 })
      e.n++
      e.r += p.b!.r
    }
    const missing = frozen.filter((t) => !held.has(keyOf(t)))
    const extra = rows[y.name].hold.run.trades.filter((t) => !frozenKeys.has(keyOf(t)))
    const same = frozen.filter((t) => t.why !== 'time' && held.has(keyOf(t)))
    lines.push(
      `paired view (hold with overnight costs): of the ${clock.length} trades the clock closed (${f(sum(clock.map((t) => t.r)), 1)}R), ${both.length} were also taken under hold and made ${f(sum(both.map((p) => p.b!.r)), 1)}R there (those same trades made ${f(sum(both.map((p) => p.a.r)), 1)}R on the clock): ${
        Object.entries(how)
          .map(([w, e]) => `${w} ${e.n} (${f(e.r, 1)}R)`)
          .join('; ') || 'none'
      }`,
    )
    lines.push(
      `   trades taken by both and not closed by the clock: ${same.length} (${f(sum(same.map((t) => t.r)), 1)}R frozen, ${f(sum(same.map((t) => held.get(keyOf(t))!.r)), 1)}R hold); frozen trades the hold run did not take: ${missing.length} (${f(sum(missing.map((t) => t.r)), 1)}R frozen); hold trades the frozen run did not take: ${extra.length} (${f(sum(extra.map((t) => t.r)), 1)}R)`,
    )
    results[`${y.name} paired`] = {
      clockClosed: clock.length,
      alsoHeld: both.length,
      heldEnded: how,
      missing: missing.length,
      extra: extra.length,
    }
  }

  // The reading written in the plan before any run (docs/v1-hold-study.md), on the result with overnight costs.
  const fine = YEARS.every((y) => {
    const a = rows[y.name].frozen
    const b = rows[y.name].hold
    return (
      b.run.endBalance > V1.startMoney &&
      b.s.totalR >= a.s.totalR - 5 &&
      b.run.maxDrawdown <= a.run.maxDrawdown + 0.05
    )
  })
  const breaks = YEARS.some((y) => {
    const a = rows[y.name].frozen
    const b = rows[y.name].hold
    return (
      b.run.endBalance < V1.startMoney || b.s.totalR < a.s.totalR - 10 || b.run.maxDrawdown > 0.25
    )
  })
  const reading = breaks ? 'HOLDING BREAKS IT' : fine ? 'HOLDING IS FINE' : 'UNCLEAR'
  lines.push(
    `\nThe reading fixed in the plan (hold with overnight costs against frozen, both years): ${reading}`,
  )
  for (const y of YEARS) {
    const a = rows[y.name].frozen
    const b = rows[y.name].hold
    lines.push(
      `   ${y.name}: total ${f(b.s.totalR, 1)}R against ${f(a.s.totalR, 1)}R (gap ${f(b.s.totalR - a.s.totalR, 1)}R); $${b.run.endBalance.toFixed(0)} against $${a.run.endBalance.toFixed(0)}; worst drop ${f(b.run.maxDrawdown * 100, 1)}% against ${f(a.run.maxDrawdown * 100, 1)}%`,
    )
  }
  lines.push(
    reproduced
      ? 'The frozen runs match the frozen record: the hold numbers stand as a description of these two seen years (not proof).'
      : 'THE FROZEN RUNS DO NOT MATCH THE FROZEN RECORD: the hold numbers are not a result.',
  )
  console.log(lines.join('\n'))
  writeFileSync(join(OUT, 'results.txt'), lines.join('\n') + '\n')
  writeFileSync(
    join(OUT, 'results.json'),
    JSON.stringify({ reading, reproduced, results }, null, 1),
  )
  if (!reproduced) process.exit(2)
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
