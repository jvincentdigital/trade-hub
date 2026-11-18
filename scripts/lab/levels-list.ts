/**
 * Levels study: write the list of levels and the list of visits of one market
 * for one year (docs/levels-study.md, "How the numbers are checked"), with the
 * same library code the study uses. Compare with scripts/lab/levels_compare.py.
 *
 *   ./node_modules/.bin/tsx scripts/lab/levels-list.ts <file.csv.gz> <MARKET> <year> <out dir>
 *
 * Swings, ATRs, zones and what is remembered run over the whole file from its
 * first candle; the lists hold what belongs to <year> (UTC): levels.csv the
 * levels whose first watched minute is in it, visits.csv the visits whose
 * touch minute is in it (levels, round numbers and every twin). Offline, play
 * money only.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HARMONIC_MARKETS, type HarmonicMarket } from '../../src/lib/lab/harmonic'
import { loadBars } from '../../src/lib/lab/harmonicLoad'
import { runLevels, type LevelRec, type VisitRec } from '../../src/lib/lab/levels'

const LEVELS_HEADER = 'kind,what,known_from,first_watched,low,high,atr,left_out'
const VISITS_HEADER =
  'kind,twin,what,known_from,side,touch,near,far,atr,r010,r010_t,r025,r025_t,r050,r050_t,r100,r100_t,m15,m60,how_far,end,end_t,brk_t,b010,b010_t,b025,b025_t,b050,b050_t,b100,b100_t'

const f = (x: number) => x.toFixed(10)
const s = (x: number | null) => (x === null ? '' : String(x))
const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0)

export function levelRow(l: LevelRec): string {
  return [
    l.kind,
    l.what,
    l.knownFrom,
    l.firstWatched,
    f(l.low),
    f(l.high),
    f(l.atr),
    l.leftOut ? 1 : 0,
  ].join(',')
}

export function visitRow(v: VisitRec): string {
  const cells: (string | number)[] = [
    v.kind,
    v.twin,
    v.what,
    s(v.knownFrom),
    v.side,
    v.touch,
    f(v.near),
    f(v.far),
    f(v.atr),
  ]
  for (let k = 0; k < 4; k++) cells.push(v.race[k], s(v.raceAt[k]))
  cells.push(v.m15, v.m60, f(v.howFar), v.end, s(v.endAt), s(v.brkAt))
  for (let k = 0; k < 4; k++) cells.push(v.run[k], s(v.runAt[k]))
  return cells.join(',')
}

async function main() {
  const [file, marketArg, yearArg, outDir] = process.argv.slice(2)
  if (!file || !marketArg || !yearArg || !outDir)
    throw new Error('usage: levels-list.ts <file.csv.gz> <MARKET> <year> <out dir>')
  const market = marketArg as HarmonicMarket
  if (!HARMONIC_MARKETS.includes(market)) throw new Error(`unknown market ${marketArg}`)
  const year = Number(yearArg)
  const t0 = Date.now()
  const bars = await loadBars(file)
  const t1 = Date.now()
  const run = runLevels(bars, market, { listYear: year })
  const t2 = Date.now()

  const levels = run.levels
    .filter((l) => l.year === year)
    .sort(
      (a, b) =>
        a.firstWatched - b.firstWatched ||
        cmp(a.kind, b.kind) ||
        cmp(a.what, b.what) ||
        a.low - b.low,
    )
  const visits = [...run.visits.filter((v) => v.year === year), ...run.twinVisits].sort(
    (a, b) =>
      a.touch - b.touch ||
      cmp(a.kind, b.kind) ||
      cmp(a.twin, b.twin) ||
      cmp(a.what, b.what) ||
      (a.knownFrom ?? -1) - (b.knownFrom ?? -1) ||
      cmp(a.side, b.side) ||
      a.near - b.near,
  )
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    join(outDir, 'levels.csv'),
    [LEVELS_HEADER, ...levels.map(levelRow)].join('\n') + '\n',
  )
  writeFileSync(
    join(outDir, 'visits.csv'),
    [VISITS_HEADER, ...visits.map(visitRow)].join('\n') + '\n',
  )

  const byKind = new Map<string, number>()
  for (const l of levels) byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + 1)
  const vKind = new Map<string, number>()
  for (const v of visits) {
    const k = v.twin === 'level' ? v.kind : `${v.kind} twins`
    vKind.set(k, (vKind.get(k) ?? 0) + 1)
  }
  const fmt = (m: Map<string, number>) =>
    [...m]
      .sort((a, b) => cmp(a[0], b[0]))
      .map(([k, c]) => `${k} ${c}`)
      .join(', ')
  const rss = process.resourceUsage().maxRSS / 1024
  console.log(
    `${market} ${year}: ${bars.n} bars; read ${(t1 - t0) / 1000}s, run ${(t2 - t1) / 1000}s, peak ${rss.toFixed(0)} MB`,
  )
  console.log(`levels ${levels.length}: ${fmt(byKind)}`)
  console.log(`visits ${visits.length}: ${fmt(vKind)}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
