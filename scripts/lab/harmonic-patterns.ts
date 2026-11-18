/**
 * Harmonic study: write the pattern list of one market, chart and swing size
 * for one year (docs/harmonic-study.md, Amendment 3 point 3), with the same
 * library code the study uses. Compare with scripts/lab/harmonic_compare.py.
 *
 *   ./node_modules/.bin/tsx scripts/lab/harmonic-patterns.ts <file.csv.gz> <MARKET> <15|30> <2|3> <year> <out.csv>
 *
 * Swings run over the whole file; the list holds every pattern whose
 * confirming candle closes in <year> (UTC). Offline, play money only.
 */
import { writeFileSync } from 'node:fs'
import {
  findPatterns,
  findSwings,
  harmonicContext,
  HARMONIC_MARKETS,
  type HarmonicMarket,
  type Pattern,
} from '../../src/lib/lab/harmonic'
import { loadBars } from '../../src/lib/lab/harmonicLoad'

const HEADER =
  'chart,k,pattern,dir,x_time,x,a_time,a,b_time,b,c_time,c,confirm_time,d,stop,outcome,outcome_time'

export function patternRow(p: Pattern): string {
  const f = (x: number) => x.toFixed(10)
  const w = p.wait
  const when = w.outcome === 'skipped' || w.outcome === 'waiting' ? '' : String(w.time)
  return [
    p.chart,
    p.k,
    p.name,
    p.dir === 1 ? 'buy' : 'sell',
    p.x.time,
    f(p.x.price),
    p.a.time,
    f(p.a.price),
    p.b.time,
    f(p.b.price),
    p.c.time,
    f(p.c.price),
    p.confirmTime,
    f(p.d),
    f(p.stop),
    w.outcome,
    when,
  ].join(',')
}

async function main() {
  const [file, market, chartArg, kArg, yearArg, out] = process.argv.slice(2)
  const chart = Number(chartArg)
  const k = Number(kArg)
  const year = Number(yearArg)
  if (
    !out ||
    !HARMONIC_MARKETS.includes(market as HarmonicMarket) ||
    (chart !== 15 && chart !== 30) ||
    (k !== 2 && k !== 3) ||
    !Number.isInteger(year)
  ) {
    console.error(
      'usage: harmonic-patterns.ts <file.csv.gz> <MARKET> <15|30> <2|3> <year> <out.csv>',
    )
    process.exit(2)
  }
  const t0 = Date.now()
  const bars = await loadBars(file)
  const t1 = Date.now()
  const ctx = harmonicContext(bars, market as HarmonicMarket, chart)
  const c = ctx.chart
  const patterns = findPatterns(bars, c, ctx.costs, k, findSwings(c.high, c.low, c.close, k))
  const inYear = patterns.filter((p) => new Date(p.confirmClose * 1000).getUTCFullYear() === year)
  const order = (p: Pattern) => [p.confirmTime, p.name, p.dir === 1 ? 'buy' : 'sell'] as const
  inYear.sort((a, b) => {
    const [x, y] = [order(a), order(b)]
    if (x[0] !== y[0]) return x[0] - y[0]
    if (x[1] !== y[1]) return x[1] < y[1] ? -1 : 1
    return x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0
  })
  writeFileSync(out, [HEADER, ...inYear.map(patternRow)].join('\n') + '\n')
  const by: Record<string, number> = {}
  for (const p of inYear) by[p.wait.outcome] = (by[p.wait.outcome] ?? 0) + 1
  console.log(
    `${market} ${chart}m k=${k} ${year}: ${inYear.length} patterns (${patterns.length} in the file); ` +
      Object.entries(by)
        .sort()
        .map(([o, n]) => `${o} ${n}`)
        .join(', '),
  )
  console.log(
    `${bars.n} bars, ${c.n} chart candles; load ${((t1 - t0) / 1000).toFixed(1)} s, find ${((Date.now() - t1) / 1000).toFixed(1)} s`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
