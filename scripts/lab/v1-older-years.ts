/**
 * John's London v1: one exam on older years it has never seen
 * (docs/v1-older-years-exam.md; the plan and Amendment 1 were committed and
 * pushed before this script ran on any HistData file). Offline, play money
 * research.
 *
 *   tsx scripts/lab/v1-older-years.ts --phase splice --frozen <frozen 1-minute dir> --data <histdata dir> --out <dir>
 *   tsx scripts/lab/v1-older-years.ts --phase exam   --frozen <frozen 1-minute dir> --data <histdata dir> --out <dir>
 *
 * splice (Check 2, the gate, seen year only, may be repeated): frozen v1 on
 *   2024-11-11 to 2025-11-10 with the HistData candles and the frozen news
 *   list, against the same run on the frozen files.
 * exam (once): frozen v1 on 2019-01-01 to 2024-11-10 with the HistData candles
 *   and the 2019 to 2024 news list, plus the two declared runs without a
 *   verdict (no news list; the hold rule with overnight costs). It refuses to
 *   start unless the gate passed, the three data files match the fingerprints
 *   fixed in Amendment 1, and it has not been run before.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { OHLCCandle } from '../../src/lib/types/market'
import {
  CLEAN_START,
  coinRun,
  DESIGN_START,
  isTradingDay,
  LONDON_MARKETS,
  mirrorTest,
  p95,
  passLines,
  prepareMarket,
  rescoreCosts,
  runLondon,
  sessionFor,
  summarize,
  V1,
  type LondonData,
  type LondonMarketId,
  type LondonTrade,
  type RunOptions,
} from '../../src/lib/lab/johnsLondon'
import { loadCandleFile, loadNews } from '../../src/lib/lab/load'
import { ismEvents, type NewsEvent } from '../../src/lib/lab/news'

const DAY = 86_400
const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`)
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${k}`)
  return process.argv[i + 1]
}
const PHASE = arg('phase')
const FROZEN = resolve(arg('frozen'))
const DATA = resolve(arg('data'))
const OUT = resolve(arg('out'))
const MARKER = join(DATA, 'EXAM-DONE.json')

/** The exam years: 2019-01-01 to the day before v1's test year starts. */
const EXAM_FROM = Date.UTC(2019, 0, 1) / 1000
const EXAM_TO = CLEAN_START
/** Fixed in Amendment 1 before any rule ran on these files. */
const SHA = {
  GBPUSD: 'fdd7ff9806ef0aca5991479a3ea648a2d10f66d492b9799f6d7682899deed577',
  XAUUSD: '918b9c8113a1812acc1861cb043df8b62840950c74df5a4f8457a76f09bcbcf3',
  news: '162bba6066ebd9eff740fd2348cd7971499ff2853ff90cf5e4a38412fd421897',
} as const
/** Check 2's three lines (the plan). */
const GATE = {
  tradesMin: 78,
  tradesMax: 116,
  totalMin: 17.6,
  totalMax: 37.6,
  twinShare: 0.6,
  twinWithin: 30 * 60,
}
/** A market sits out a weekday with under 90% of the 570 London minutes (Amendment 1). */
const THIN_SHARE = 0.9

const f = (x: number | null, d = 2) => (x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d))
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const histFile = (id: string) => join(DATA, id, `${id}_1m.csv.gz`)
const newsDir = join(DATA, 'news-2019-2024')

/** Remove, for one market, every weekday whose London window (07:00 to 16:30 London) holds too few 1-minute candles. */
function dropThinDays(m1: OHLCCandle[]): { kept: OHLCCandle[]; dropped: string[] } {
  const inWindow = new Map<number, number>()
  for (const b of m1) {
    const day = Math.floor(b.time / DAY) * DAY
    const s = sessionFor(day)
    if (b.time >= s.start && b.time < s.timeExit) inWindow.set(day, (inWindow.get(day) ?? 0) + 1)
    else if (!inWindow.has(day)) inWindow.set(day, 0)
  }
  const thin = new Set<number>()
  for (const [day, n] of inWindow) {
    const s = sessionFor(day)
    const window = (s.timeExit - s.start) / 60
    if (isTradingDay(day) && n < THIN_SHARE * window) thin.add(day)
  }
  return {
    kept: m1.filter((b) => !thin.has(Math.floor(b.time / DAY) * DAY)),
    dropped: [...thin]
      .sort((a, b) => a - b)
      .map((d) => new Date(d * 1000).toISOString().slice(0, 10)),
  }
}

function prepare(
  m1: Record<string, OHLCCandle[]>,
  from: number,
  to: number,
  news: NewsEvent[],
  thin: boolean,
) {
  const dropped: Record<string, string[]> = {}
  const data: LondonData[] = LONDON_MARKETS.map((id) => {
    const slice = m1[id].filter((b) => b.time >= from && b.time < to)
    const d = thin ? dropThinDays(slice) : { kept: slice, dropped: [] }
    dropped[id] = d.dropped
    return prepareMarket(id, d.kept, news)
  })
  return { data, byId: new Map<LondonMarketId, LondonData>(data.map((d) => [d.id, d])), dropped }
}

function score(
  data: LondonData[],
  byId: Map<LondonMarketId, LondonData>,
  o: RunOptions,
  from: number,
  to: number,
) {
  const run = runLondon(data, o, from, to)
  const s = summarize(run.trades)
  const mirror = mirrorTest(run.trades, byId, o.hold)
  const coins: number[] = []
  for (let seed = 1; seed <= 1000; seed++) coins.push(coinRun(run.trades, byId, seed, o.hold).total)
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
  return { run, s, mirror, coinP95, pass }
}

const headline = (label: string, x: ReturnType<typeof score>) =>
  `${label.padEnd(34)} trades ${String(x.s.trades).padStart(3)}  total ${f(x.s.totalR, 1).padStart(6)}R  avg ${f(x.s.avgR)}R  won ${f(x.s.winRate * 100, 0)}%  PF ${f(x.s.profitFactor)}  $${x.run.endBalance.toFixed(0)}  drop ${f(x.run.maxDrawdown * 100, 1)}%  coin p95 ${f(x.coinP95, 1)}R  mirror z ${f(x.mirror.z)}`

function breakdown(trades: LondonTrade[]): string[] {
  const out: string[] = []
  const years = [...new Set(trades.map((t) => t.day.slice(0, 4)))].sort()
  for (const y of years) {
    const ts = trades.filter((t) => t.day.startsWith(y))
    const s = summarize(ts)
    out.push(
      `   ${y}: trades ${String(s.trades).padStart(3)}  total ${f(s.totalR, 1).padStart(6)}R  avg ${f(s.avgR)}R  won ${f(s.winRate * 100, 0)}%  ${LONDON_MARKETS.map(
        (m) => {
          const x = summarize(ts.filter((t) => t.market === m))
          return `${m} ${x.trades}/${f(x.totalR, 1)}R`
        },
      ).join(' ')}`,
    )
  }
  const ends: Record<string, { n: number; r: number }> = {}
  for (const t of trades) {
    const e = (ends[t.why] ??= { n: 0, r: 0 })
    e.n++
    e.r += t.r
  }
  out.push(
    `   ended: ${Object.entries(ends)
      .sort((a, b) => b[1].n - a[1].n)
      .map(([w, e]) => `${w} ${e.n} (${f(e.r, 1)}R)`)
      .join('; ')}`,
  )
  const sides = [true, false].map((long) => {
    const x = summarize(trades.filter((t) => t.long === long))
    return `${long ? 'buys' : 'sells'} ${x.trades}/${f(x.totalR, 1)}R`
  })
  out.push(`   sides: ${sides.join(', ')}`)
  return out
}

async function loadAll() {
  const hist: Record<string, OHLCCandle[]> = {}
  for (const id of LONDON_MARKETS) hist[id] = await loadCandleFile(histFile(id))
  return hist
}

async function splice() {
  mkdirSync(OUT, { recursive: true })
  const lines: string[] = []
  const frozenM1: Record<string, OHLCCandle[]> = {}
  for (const id of LONDON_MARKETS)
    frozenM1[id] = await loadCandleFile(join(FROZEN, id, `${id}_1m.csv.gz`))
  const hist = await loadAll()
  const from = CLEAN_START
  const to = DESIGN_START
  const news = [...(await loadNews(FROZEN)), ...ismEvents(from - 30 * DAY, to + DAY)]
  const a = prepare(frozenM1, from, to, news, false)
  const b = prepare(hist, from, to, news, true)
  const base = runLondon(a.data, { k: 2, b: 0.5 }, from, to)
  const got = runLondon(b.data, { k: 2, b: 0.5 }, from, to)
  const sa = summarize(base.trades)
  const sb = summarize(got.trades)
  const twins = base.trades.filter((t) =>
    got.trades.some(
      (u) =>
        u.market === t.market &&
        u.long === t.long &&
        Math.abs(u.entryTime - t.entryTime) <= GATE.twinWithin,
    ),
  ).length
  const share = twins / base.trades.length
  const same =
    createHash('sha256').update(JSON.stringify(base.trades)).digest('hex') ===
    createHash('sha256').update(JSON.stringify(got.trades)).digest('hex')
  const checks = [
    {
      text: `between ${GATE.tradesMin} and ${GATE.tradesMax} trades`,
      ok: sb.trades >= GATE.tradesMin && sb.trades <= GATE.tradesMax,
    },
    {
      text: `total between +${GATE.totalMin}R and +${GATE.totalMax}R`,
      ok: sb.totalR >= GATE.totalMin && sb.totalR <= GATE.totalMax,
    },
    {
      text: `at least ${GATE.twinShare * 100}% of the frozen run's trades have a twin`,
      ok: share >= GATE.twinShare,
    },
  ]
  const pass = checks.every((c) => c.ok)
  lines.push('Check 2, the splice: frozen v1 on the seen year 2024-11-11 to 2025-11-10')
  lines.push(
    `frozen files:   trades ${sa.trades}  total ${f(sa.totalR, 1)}R  $${base.endBalance.toFixed(0)}  drop ${f(base.maxDrawdown * 100, 1)}%`,
  )
  lines.push(
    `HistData files: trades ${sb.trades}  total ${f(sb.totalR, 1)}R  $${got.endBalance.toFixed(0)}  drop ${f(got.maxDrawdown * 100, 1)}%`,
  )
  lines.push(
    `twins: ${twins} of ${base.trades.length} (${f(share * 100, 0)}%); trade lists identical: ${same ? 'yes' : 'no'}`,
  )
  lines.push(
    `thin days sat out on the HistData side: ${LONDON_MARKETS.map((id) => `${id} ${b.dropped[id].length} (${b.dropped[id].join(', ') || 'none'})`).join('; ')}`,
  )
  for (const c of checks) lines.push(`   ${c.ok ? 'pass' : 'FAIL'}  ${c.text}`)
  lines.push(pass ? 'THE GATE PASSES: the exam may run.' : 'THE GATE FAILS: the exam does not run.')
  console.log(lines.join('\n'))
  writeFileSync(join(OUT, 'splice.txt'), lines.join('\n') + '\n')
  writeFileSync(
    join(OUT, 'splice.json'),
    JSON.stringify(
      { pass, checks, frozen: sa, histdata: sb, twins, share, identical: same, dropped: b.dropped },
      null,
      1,
    ),
  )
  if (!pass) process.exit(2)
}

async function exam() {
  mkdirSync(OUT, { recursive: true })
  // The gate, the fingerprints and the one-run marker, before a candle is read.
  const gateFile = join(OUT, 'splice.json')
  if (!existsSync(gateFile) || JSON.parse(readFileSync(gateFile, 'utf8')).pass !== true)
    throw new Error('Check 2 has not passed in this output folder: run --phase splice first')
  for (const id of LONDON_MARKETS)
    if (sha256(histFile(id)) !== SHA[id])
      throw new Error(`${histFile(id)} is not the file fixed in Amendment 1`)
  if (sha256(join(newsDir, 'news-high-impact.csv')) !== SHA.news)
    throw new Error('the 2019 to 2024 news list is not the file fixed in Amendment 1')
  if (existsSync(MARKER)) throw new Error(`the exam has already been run (${MARKER})`)
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
  if (dirty) throw new Error('the working tree is not clean: commit the runner before the exam')

  const hist = await loadAll()
  const list = await loadNews(newsDir)
  const news = [...list, ...ismEvents(EXAM_FROM - 30 * DAY, EXAM_TO + DAY)]
  writeFileSync(
    MARKER,
    JSON.stringify({ status: 'started', commit, out: OUT, files: SHA }, null, 1),
  )

  const lines: string[] = []
  const results: Record<string, unknown> = { commit, from: EXAM_FROM, to: EXAM_TO }
  lines.push(
    "John's London v1 on 2019-01-01 to 2024-11-10 (HistData 1-minute candles, never seen by the rule)",
  )
  lines.push(`code ${commit}`)

  // The main run: the frozen rule, with the 2019 to 2024 news list.
  const main = prepare(hist, EXAM_FROM, EXAM_TO, news, true)
  for (const id of LONDON_MARKETS) {
    const perYear: Record<string, number> = {}
    for (const d of main.dropped[id]) perYear[d.slice(0, 4)] = (perYear[d.slice(0, 4)] ?? 0) + 1
    lines.push(
      `thin days sat out, ${id}: ${main.dropped[id].length} (${Object.entries(perYear)
        .map(([y, n]) => `${y}: ${n}`)
        .join(', ')})`,
    )
  }
  results.dropped = main.dropped
  const m = score(main.data, main.byId, { k: 2, b: 0.5 }, EXAM_FROM, EXAM_TO)
  lines.push('')
  lines.push(headline('MAIN: frozen v1', m))
  for (const l of m.pass.lines) lines.push(`   ${l.ok ? 'pass' : 'FAIL'}  ${l.text}`)
  lines.push(`   VERDICT: ${m.pass.verdict}`)
  lines.push(...breakdown(m.run.trades))
  const doubled = sum(m.run.trades.map((t) => rescoreCosts(t, main.byId.get(t.market)!, 2)))
  lines.push(
    `   with every cost doubled: total ${f(doubled, 1)}R; signals ${m.run.signals}; most open at once ${m.run.maxOpenSeen}; longest losing run ${m.s.longestLosingRun}; without the best 3 trades ${f(m.s.withoutBest3R, 1)}R`,
  )
  writeFileSync(join(OUT, 'trades-main.json'), JSON.stringify(m.run.trades, null, 1))
  results.main = {
    summary: m.s,
    endBalance: m.run.endBalance,
    maxDrawdown: m.run.maxDrawdown,
    mirror: m.mirror,
    coinP95: m.coinP95,
    pass: m.pass,
    costDoubledR: doubled,
    signals: m.run.signals,
  }

  // Declared run 1, no verdict: no news list at all.
  const bare = prepare(hist, EXAM_FROM, EXAM_TO, [], true)
  const n = score(bare.data, bare.byId, { k: 2, b: 0.5 }, EXAM_FROM, EXAM_TO)
  lines.push('')
  lines.push(headline('declared: no news list', n))
  lines.push(`   six lines (description only): ${n.pass.verdict}`)
  lines.push(...breakdown(n.run.trades))
  writeFileSync(join(OUT, 'trades-no-news.json'), JSON.stringify(n.run.trades, null, 1))
  results.noNews = {
    summary: n.s,
    endBalance: n.run.endBalance,
    maxDrawdown: n.run.maxDrawdown,
    mirror: n.mirror,
    coinP95: n.coinP95,
    pass: n.pass,
  }

  // Declared run 2, no verdict: the hold rule with overnight costs.
  const h = score(main.data, main.byId, { k: 2, b: 0.5, hold: 'costs' }, EXAM_FROM, EXAM_TO)
  lines.push('')
  lines.push(headline('declared: hold, overnight costs', h))
  lines.push(`   six lines (description only): ${h.pass.verdict}`)
  lines.push(...breakdown(h.run.trades))
  writeFileSync(join(OUT, 'trades-hold.json'), JSON.stringify(h.run.trades, null, 1))
  results.hold = {
    summary: h.s,
    endBalance: h.run.endBalance,
    maxDrawdown: h.run.maxDrawdown,
    mirror: h.mirror,
    coinP95: h.coinP95,
    pass: h.pass,
  }

  lines.push('')
  lines.push(
    m.pass.verdict === n.pass.verdict
      ? `The main run and the no-news run agree: ${m.pass.verdict}.`
      : `The main run (${m.pass.verdict}) and the no-news run (${n.pass.verdict}) disagree: the result depends on the news rule.`,
  )
  console.log(lines.join('\n'))
  writeFileSync(join(OUT, 'results.txt'), lines.join('\n') + '\n')
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1))
  writeFileSync(
    MARKER,
    JSON.stringify(
      { status: 'finished', commit, out: OUT, files: SHA, verdict: m.pass.verdict },
      null,
      1,
    ),
  )
}

;(PHASE === 'splice'
  ? splice()
  : PHASE === 'exam'
    ? exam()
    : Promise.reject(new Error('--phase splice | exam'))
).catch((e) => {
  console.error(e.message)
  process.exit(1)
})
