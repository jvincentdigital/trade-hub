/**
 * Exploration, not a test: why does v1 skip so many setups, and what would
 * the ones skipped for "plan under 1.5R" have done with a 1.0R minimum?
 * Both years have been seen, so nothing here is proof; it only says whether a
 * live play-money copy with the lower minimum is worth running.
 *
 *   tsx scripts/lab/v1-skips.ts --history <dir with the 1-minute files>
 */
import { join, resolve } from 'node:path'
import type { OHLCCandle } from '../../src/lib/types/market'
import {
  CLEAN_START,
  DESIGN_START,
  LONDON_MARKETS,
  prepareMarket,
  runLondon,
  summarize,
  V1,
  type LondonData,
  type LondonTrade,
} from '../../src/lib/lab/johnsLondon'
import { loadCandleFile, loadNews } from '../../src/lib/lab/load'
import { ismEvents } from '../../src/lib/lab/news'

const DAY = 86_400
const HISTORY = resolve(process.argv[process.argv.indexOf('--history') + 1])
const YEARS = [
  { name: 'clean', from: CLEAN_START, to: DESIGN_START },
  { name: 'design', from: DESIGN_START, to: Date.parse('2026-11-11T00:00:00Z') / 1000 },
]
const f = (x: number | null, d = 2) => (x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d))
const key = (t: LondonTrade) => `${t.market}|${t.entryTime}|${t.long}`

async function main() {
  const m1: Record<string, OHLCCandle[]> = {}
  for (const id of LONDON_MARKETS)
    m1[id] = await loadCandleFile(join(HISTORY, id, `${id}_1m.csv.gz`))
  const newsList = await loadNews(HISTORY)
  for (const y of YEARS) {
    const news = [...newsList, ...ismEvents(y.from - 30 * DAY, y.to + DAY)]
    const data = (): LondonData[] =>
      LONDON_MARKETS.map((id) =>
        prepareMarket(
          id,
          m1[id].filter((b) => b.time >= y.from && b.time < y.to),
          news,
        ),
      )
    const rr = V1 as unknown as { rrMin: number }
    rr.rrMin = 1.5
    const base = runLondon(data(), { k: 2, b: 0.5 }, y.from, y.to)
    const reasons: Record<string, number> = {}
    for (const o of base.outcomes) reasons[o.result] = (reasons[o.result] ?? 0) + 1
    console.log(`\n== ${y.name}: ${base.signals} signals, what came of each`)
    for (const [k, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(n).padStart(4)}  ${k}`)
    rr.rrMin = 1.0
    const wide = runLondon(data(), { k: 2, b: 0.5 }, y.from, y.to)
    rr.rrMin = 1.5
    const had = new Set(base.trades.map(key))
    const added = wide.trades.filter((t) => !had.has(key(t)))
    for (const [name, run, ts] of [
      ['minimum 1.5R (v1)', base, base.trades],
      ['minimum 1.0R', wide, wide.trades],
      ['  only the added trades', null, added],
    ] as const) {
      const s = summarize(ts as LondonTrade[])
      console.log(
        `${name.padEnd(24)} trades ${String(s.trades).padStart(3)}  total ${f(s.totalR, 1)}R  avg ${f(s.avgR)}R  won ${f(s.winRate * 100, 0)}%  PF ${f(s.profitFactor)}${run ? `  $${run.endBalance.toFixed(0)}  drop ${f(run.maxDrawdown * 100, 1)}%` : ''}`,
      )
    }
  }
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
