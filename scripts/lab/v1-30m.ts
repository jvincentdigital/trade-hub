/**
 * John's London v1 on the 30-minute chart (docs/v1-30m-study.md, the plan was
 * committed before the first run). Runs the frozen v1 (k = 2, b = 0.5) on the
 * 15-minute chart first, which must reproduce the frozen numbers, then the
 * same rules on the 30-minute chart. Offline, play money research.
 *
 *   tsx scripts/lab/v1-30m.ts --history <dir with the 1-minute files> --out <dir>
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
  mirrorTest,
  p95,
  parseFreezeRecord,
  passLines,
  prepareMarket,
  runLondon,
  setChartSec,
  summarize,
  V1,
  type LondonData,
  type LondonMarketId,
} from '../../src/lib/lab/johnsLondon'
import { loadCandleFile, loadNews } from '../../src/lib/lab/load'
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
/** The frozen 15-minute numbers the runner must reproduce (docs/london-v1-freeze.md, strategy-lab.md). */
const FROZEN = { clean: { trades: 97, totalR: 27.6 }, design: { trades: 121, totalR: 24.1 } }
const f = (x: number | null, d = 2) => (x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d))

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
  let reproduced = true
  for (const sec of [900, 1800]) {
    setChartSec(sec)
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
      const run = runLondon(data, { k: 2, b: 0.5 }, y.from, y.to)
      const s = summarize(run.trades)
      const mirror = mirrorTest(run.trades, byId)
      const coins: number[] = []
      for (let seed = 1; seed <= 1000; seed++) coins.push(coinRun(run.trades, byId, seed).total)
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
      const per = Object.fromEntries(
        LONDON_MARKETS.map((m) => {
          const x = summarize(run.trades.filter((t) => t.market === m))
          return [m, { trades: x.trades, totalR: x.totalR }]
        }),
      )
      const name = `${sec / 60}m ${y.name}`
      results[name] = {
        summary: s,
        endBalance: run.endBalance,
        maxDrawdown: run.maxDrawdown,
        signals: run.signals,
        mirror,
        coinP95,
        pass,
        per,
      }
      lines.push(
        `${name.padEnd(11)} signals ${String(run.signals).padStart(4)}  trades ${String(s.trades).padStart(3)}  total ${f(s.totalR, 1)}R  avg ${f(s.avgR)}R  won ${f(s.winRate * 100, 0)}%  PF ${f(s.profitFactor)}  $${run.endBalance.toFixed(0)}  drop ${f(run.maxDrawdown * 100, 1)}%  coin p95 ${f(coinP95, 1)}R  mirror z ${f(mirror.z)}  ${Object.entries(
          per,
        )
          .map(([m, x]) => `${m} ${x.trades}/${f(x.totalR, 1)}R`)
          .join(' ')}`,
      )
      for (const l of pass.lines) lines.push(`   ${l.ok ? 'pass' : 'FAIL'}  ${l.text}`)
      lines.push(`   verdict: ${pass.verdict}`)
      if (sec === 900) {
        const want = FROZEN[y.name]
        const ok = s.trades === want.trades && Math.abs(s.totalR - want.totalR) < 0.06
        lines.push(
          `   reproduces the frozen run (${want.trades} trades, ${want.totalR}R): ${ok ? 'yes' : 'NO'}`,
        )
        reproduced &&= ok
      }
      writeFileSync(
        join(OUT, `trades-${sec / 60}m-${y.name}.json`),
        JSON.stringify(run.trades, null, 1),
      )
    }
  }
  setChartSec(900)
  lines.push(
    reproduced
      ? 'The 15-minute runs match the frozen record: the 30-minute numbers stand.'
      : 'THE 15-MINUTE RUNS DO NOT MATCH THE FROZEN RECORD: the 30-minute numbers are not a result.',
  )
  console.log(lines.join('\n'))
  writeFileSync(join(OUT, 'results.txt'), lines.join('\n') + '\n')
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1))
}
main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
