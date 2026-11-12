/**
 * John's Method: the design runs, the pick, the filter search and the freeze
 * (SPEC.md ~/jvd-outputs/2026-11-12/johns-method/SPEC.md, sections 3 to 6).
 *
 *   npx tsx scripts/lab/johns-method.ts --history ~/jvd-outputs/trading/history-majors \
 *     --from 2024-11-11 --to 2026-11-10 --out DIR [--markets EURUSD,GBPUSD] [--variant all|JM-H4H1-X1-C,...] [--freeze]
 *
 * Design mode refuses any date before 2024-11-11 (warm-up candles from
 * 2023-09-01 are read for indicators only, rows before that are skipped
 * without reading their prices). Each design year is its own run from
 * $10,000, in two books: the account book (all 8 markets, every limit) and
 * the signal book (each market alone, flat $10,000). Writes per variant a
 * trade list CSV per year and book (and its SHA-256) and summary.json, then
 * pick.json, RESULTS.md and data-manifest.json. With --freeze (all 18
 * variants, clean tree) it also writes the freeze record to
 * docs/johns-method-freeze.md and a byte copy to DIR/../FROZEN-BASE.txt.
 *
 * Exam mode, once, from the freeze commit (section 4):
 *
 *   npx tsx scripts/lab/johns-method.ts --exam --history ~/jvd-outputs/trading/history-majors \
 *     --from 2019-01-01 --to 2024-11-10 --out EXAMDIR
 *
 * Before it reads a candle it checks the freeze record: a clean tree, nothing
 * but the freeze file changed since the code commit, SPEC.md and the eight
 * 1-hour files matching their hashes, and a confirmed pick. It refuses
 * otherwise. Play money research only: no broker, no network.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import type { OHLCCandle } from '../../src/lib/types/market'
import {
  assertRead,
  coinRun,
  DESIGN_Y2,
  drawdownOf,
  EXAM_FROM,
  examLines,
  FILTER_NAMES,
  filterSearch,
  findSignals,
  FREEZE_FILE,
  JM,
  JM_EXPIRIES,
  JM_MARKETS,
  JM_PAIRS,
  JM_SIZINGS,
  jmFreezeProblems,
  makeBasket,
  mirrorTest,
  p95,
  PAIR,
  pairBeats,
  parseJmFreeze,
  pickStructure,
  prepareJm,
  readWindow,
  simulate,
  stats,
  variantName,
  type FilterTrade,
  type JmData,
  type JmExpiry,
  type JmFreezeRecord,
  type JmMarketId,
  type JmPair,
  type JmRun,
  type JmSignal,
  type JmSizing,
  type JmTrade,
  type StructureRow,
} from '../../src/lib/lab/johnsMethod'
import { nyCloseBars } from '../../src/lib/lab/load'
import { parseNewsCsv, type NewsEvent } from '../../src/lib/lab/news'
import { DAY, HOUR, isoMinute, sessionOf } from '../../src/lib/lab/time'

const argv = process.argv
const has = (n: string) => argv.includes(`--${n}`)
function arg(name: string, dflt?: string): string {
  const i = argv.indexOf(`--${name}`)
  const v = i > 0 ? argv[i + 1] : undefined
  if (!v) {
    if (dflt != null) return dflt
    throw new Error(`missing --${name}`)
  }
  return v
}

const EXAM = has('exam')
const HISTORY = resolve(arg('history').replace(/^~/, homedir()))
const FROM = EXAM ? EXAM_FROM : Date.parse(`${arg('from')}T00:00:00Z`) / 1000
const TO = Date.parse(`${arg('to')}T00:00:00Z`) / 1000 + DAY // --to is the last day, included
const OUT = resolve(arg('out').replace(/^~/, homedir()))
const NEWS_FILE = join(homedir(), 'jvd-outputs/trading/history/news-high-impact.csv')
const SPEC = join(homedir(), 'jvd-outputs/2026-11-12/johns-method/SPEC.md')
const TRADE_MARKETS = arg('markets', JM_MARKETS.join(','))
  .split(',')
  .map((x) => x.trim()) as JmMarketId[]
for (const m of TRADE_MARKETS) if (!JM_MARKETS.includes(m)) throw new Error(`unknown market ${m}`)
const ALL_VARIANTS = JM_PAIRS.flatMap((p) =>
  JM_EXPIRIES.flatMap((x) => JM_SIZINGS.map((s) => variantName(p, x, s))),
)
const VARIANTS = arg('variant', 'all') === 'all' ? ALL_VARIANTS : arg('variant').split(',')
for (const v of VARIANTS) if (!ALL_VARIANTS.includes(v)) throw new Error(`unknown variant ${v}`)

const { readFrom, readTo } = readWindow(FROM, TO, EXAM)
if (/history-old|history-1m-24mo/.test(HISTORY)) throw new Error('refusing a holdout folder')

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const fileFacts = (p: string) => {
  if (!existsSync(p)) return null
  const b = readFileSync(p)
  return { size: b.length, sha256: sha(b) }
}
const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8' }).trim()
const ROOT = git('rev-parse', '--show-toplevel')
const h1File = (m: JmMarketId) => join(HISTORY, m, `${m}_1h.csv.gz`)

/** Stream a 1-hour file, keeping rows in [from, to). Rows outside are skipped on their time field alone. */
async function loadWindow(file: string, from: number, to: number): Promise<OHLCCandle[]> {
  const lines = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  })
  const out: OHLCCandle[] = []
  let n = 0
  for await (const line of lines) {
    n++
    if (!line || (n === 1 && line.startsWith('time'))) continue
    const comma = line.indexOf(',')
    const t = Number(line.slice(0, comma))
    if (!Number.isFinite(t)) throw new Error(`${file}: bad time at row ${n}`)
    if (t < from) continue
    if (t >= to) break
    const [, o, h, l, c] = line.split(',')
    const bar = { time: t, open: Number(o), high: Number(h), low: Number(l), close: Number(c) }
    if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
      throw new Error(`${file}: bad row ${n}`)
    const prev = out[out.length - 1]
    if (prev && bar.time <= prev.time) throw new Error(`${file}: rows out of order at ${n}`)
    out.push(bar)
  }
  assertRead(out, from, to, file)
  return out
}

/** Exam mode: every check of the freeze record (section 4), before any candle is read. */
function checkFreeze(): JmFreezeRecord {
  const md = readFileSync(join(ROOT, FREEZE_FILE), 'utf8')
  const rec = parseJmFreeze(md)
  let changed: string[] | null
  try {
    changed = git('-C', ROOT, 'diff', '--name-only', rec.codeCommit, 'HEAD')
      .split('\n')
      .filter(Boolean)
  } catch {
    changed = null
  }
  const problems = jmFreezeProblems(rec, {
    dirty: git('-C', ROOT, 'status', '--porcelain').split('\n').filter(Boolean),
    changedSinceCode: changed,
    specSha256: fileFacts(rec.spec.path)?.sha256 ?? null,
    files: Object.fromEntries(Object.keys(rec.files).map((p) => [p, fileFacts(p)])),
  })
  for (const m of JM_MARKETS)
    if (!rec.files[h1File(m)]) problems.push(`the record has no hash of ${h1File(m)}`)
  if (existsSync(join(OUT, 'results.json'))) problems.push(`${OUT} already holds exam results`)
  if (problems.length) throw new Error(`exam refused:\n- ${problems.join('\n- ')}`)
  return rec
}

// ── Reporting ─────────────────────────────────────────────────────────────

const f = (x: number | null | undefined, d = 5) =>
  x == null || !Number.isFinite(x) ? '' : x.toFixed(d)
const iso = (t: number | null | undefined) => (t == null || !Number.isFinite(t) ? '' : isoMinute(t))

const CSV_HEAD = [
  'id',
  'variant',
  'book',
  'market',
  'side',
  'armed',
  'x',
  'y',
  'one',
  'zero',
  'L786',
  'L886',
  'tp1',
  'tp2',
  'S',
  'S2',
  'signal_candle',
  'w',
  'travel_over_move',
  'atrF',
  'move_atr',
  'atr_ref',
  'plan_rr',
  'h1_time',
  'h1_E',
  'h1_units',
  'h1_risk_usd',
  'h1_news',
  'half2',
  'h2_time',
  'h2_E',
  'h2_units',
  'h2_risk_usd',
  'h2_news',
  'add',
  'add_trigger',
  'add_P',
  'add_time',
  'add_E',
  'add_units',
  'add_risk_usd',
  'add_news',
  'ladder_end',
  'past1_before_add',
  'exit',
  'exit_time',
  'nights',
  'swap_usd',
  'fee_usd',
  'net_usd',
  'R',
  'R_half_cost',
  'R_double_cost',
  'bal_at_entry',
  'bal_after',
  'lineDist',
  'lineAtTarget',
  'dailyTrend',
  'trend252',
  ...FILTER_NAMES.map((n) => n.split(' ')[0]),
]

function csv(ts: JmTrade[]): string {
  const rows = ts.map((t) => {
    const s = t.sig
    const part = (k: string) => t.parts.find((p) => p.kind === k)
    const h1 = part('half1') ?? part('all')
    const h2 = part('half2')
    const ad = part('add')
    const pp = (p: typeof h1) =>
      p
        ? [iso(p.time), f(p.E), f(p.units, 2), f(p.riskUsd, 2), p.nearRedNews]
        : ['', '', '', '', '']
    return [
      t.id,
      t.variant,
      t.book,
      t.market,
      t.long ? 'BUY' : 'SELL',
      iso(s.armedAt),
      iso(s.xTime),
      iso(s.yTime),
      f(s.one),
      f(s.zero),
      f(s.L786),
      f(s.L886),
      f(s.tp1),
      f(s.tp2),
      f(s.S),
      f(t.S2),
      iso(s.sigTime),
      s.w,
      f(s.travelOverMove, 3),
      f(s.atrF, 6),
      f(s.moveAtr, 3),
      f(s.atrRef, 6),
      f(s.planRR, 3),
      ...pp(h1),
      t.half2,
      ...pp(h2).slice(0, 5),
      t.add,
      iso(t.addTrigger),
      f(t.addP),
      ...pp(ad),
      t.ladderEnd,
      t.past1BeforeAdd ? 'yes' : 'no',
      t.why ?? '',
      iso(t.exitTime),
      t.nights,
      f(t.swapUsd, 2),
      f(t.feeUsd, 2),
      f(t.netUsd, 2),
      f(t.r, 4),
      f(t.rHalfCost, 4),
      f(t.rDoubleCost, 4),
      f(t.balAtEntry, 2),
      f(t.balAfter, 2),
      f(s.fields.lineDist, 3),
      s.fields.lineAtTarget ? 'yes' : 'no',
      s.fields.dailyTrend,
      s.fields.trend252 ?? '',
      ...s.fields.F.map((x) => (x ? 'yes' : 'no')),
    ].join(',')
  })
  return [CSV_HEAD.join(','), ...rows].join('\n') + '\n'
}

const sumR = (ts: JmTrade[], r: (t: JmTrade) => number = (t) => t.r) =>
  ts.reduce((a, t) => a + r(t), 0)
const groupBy = <T>(xs: T[], key: (x: T) => string) => {
  const g = new Map<string, T[]>()
  for (const x of xs) g.set(key(x), [...(g.get(key(x)) ?? []), x])
  return g
}
const astBlock = (t: number) => sessionOf(t).name

/** Section 7, reported without a pass line. */
function report(run: JmRun) {
  const ts = run.trades
  const s = stats(ts)
  const byMarket = Object.fromEntries(
    JM_MARKETS.map((m) => {
      const xs = ts.filter((t) => t.market === m)
      const st = stats(xs)
      return [m, { ...st, drag: xs.length >= 30 && st.usd < 0 }]
    }),
  )
  const month = Object.fromEntries(
    [...groupBy(ts, (t) => isoMinute(t.firstFill).slice(0, 7))].map(([k, xs]) => [
      k,
      { trades: xs.length, r: sumR(xs), usd: xs.reduce((a, t) => a + t.netUsd, 0) },
    ]),
  )
  const months = Object.entries(month)
  let run0 = 0
  let longest = 0
  for (const t of [...ts].sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0) || a.id - b.id)) {
    run0 = t.r < 0 ? run0 + 1 : 0
    longest = Math.max(longest, run0)
  }
  const rs = ts.map((t) => t.r).sort((a, b) => a - b)
  const buckets: Record<string, number> = {}
  for (let lo = -1.5; lo < 3; lo += 0.5) buckets[`${lo} to ${lo + 0.5}`] = 0
  buckets['under -1.5'] = 0
  buckets['3 and above'] = 0
  for (const r of rs) {
    if (r < -1.5) buckets['under -1.5']++
    else if (r >= 3) buckets['3 and above']++
    else {
      const lo = Math.floor(r / 0.5) * 0.5
      buckets[`${lo} to ${lo + 0.5}`]++
    }
  }
  const best = [...rs].sort((a, b) => b - a)
  const onlyHalf1 = ts.filter((t) => t.parts.length === 1 && t.parts[0].kind === 'half1')
  const skips = Object.fromEntries(
    [...groupBy(run.skips, (x) => x.why)].map(([k, v]) => [k, v.length]),
  )
  const ends = Object.fromEntries(
    [...groupBy(ts, (t) => t.why ?? '?')].map(([k, v]) => [k, v.length]),
  )
  const holdH = ts.map((t) => ((t.exitTime ?? t.firstFill) - t.firstFill) / HOUR)
  const news = (yes: boolean) =>
    ts.filter((t) => t.parts.some((p) => p.nearRedNews === 'yes') === yes)
  const split = (key: (t: JmTrade) => string) =>
    Object.fromEntries([...groupBy(ts, key)].map(([k, v]) => [k, stats(v)]))
  return {
    ...s,
    endBalance: run.endBalance,
    maxDrawdown: run.maxDrawdown,
    signals: run.signals,
    byMarket,
    buys: stats(ts.filter((t) => t.long)),
    sells: stats(ts.filter((t) => !t.long)),
    byYear: split((t) => isoMinute(t.firstFill).slice(0, 4)),
    byMonth: month,
    worstMonthR: months.length ? Math.min(...months.map(([, v]) => v.r)) : null,
    worstMonthUsd: months.length ? Math.min(...months.map(([, v]) => v.usd)) : null,
    nearRedNews: stats(news(true)),
    notNearRedNews: stats(news(false)),
    longestLosingRun: longest,
    rBuckets: buckets,
    medianR: rs.length ? rs[Math.floor((rs.length - 1) / 2)] : null,
    bestR: rs.length ? rs[rs.length - 1] : null,
    worstR: rs.length ? rs[0] : null,
    halves: {
      gotHalf2: ts.filter((t) => t.parts.some((p) => p.kind === 'half2')).length,
      together: ts.filter((t) => t.half2 === 'together').length,
      addsTriggered: ts.filter((t) => t.addTrigger != null).length,
      addsOpened: ts.filter((t) => t.add === 'opened').length,
      onlyHalf1: stats(onlyHalf1),
      past1BeforeAdd: ts.filter((t) => t.past1BeforeAdd).length,
    },
    dailyLines: {
      lineDist: split((t) =>
        t.sig.fields.lineDist == null
          ? 'none'
          : t.sig.fields.lineDist <= 0.5
            ? '0 to 0.5'
            : t.sig.fields.lineDist <= 1.5
              ? '0.5 to 1.5'
              : 'over 1.5',
      ),
      lineAtTarget: split((t) => (t.sig.fields.lineAtTarget ? 'yes' : 'no')),
      dailyTrend: split((t) => t.sig.fields.dailyTrend),
      trend252: split((t) => String(t.sig.fields.trend252)),
    },
    filters: Object.fromEntries(
      FILTER_NAMES.map((n, k) => [
        n,
        {
          yes: stats(ts.filter((t) => t.sig.fields.F[k])),
          no: stats(ts.filter((t) => !t.sig.fields.F[k])),
        },
      ]),
    ),
    costs: {
      totalRHalfCost: sumR(ts, (t) => t.rHalfCost),
      totalRDoubleCost: sumR(ts, (t) => t.rDoubleCost),
      swapUsd: ts.reduce((a, t) => a + t.swapUsd, 0),
      avgNights: ts.length ? ts.reduce((a, t) => a + t.nights, 0) / ts.length : 0,
    },
    endings: ends,
    avgHoldHours: holdH.length ? holdH.reduce((a, b) => a + b, 0) / holdH.length : 0,
    longestHoldHours: holdH.length ? Math.max(...holdH) : 0,
    withoutBest3R: best.slice(3).reduce((a, b) => a + b, 0),
    withoutBest10R: best.slice(10).reduce((a, b) => a + b, 0),
    skips,
    byHourBlock: split((t) => astBlock(t.firstFill)),
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

interface Period {
  name: 'y1' | 'y2' | 'exam'
  from: number
  to: number
}

function periods(): Period[] {
  if (EXAM) return [{ name: 'exam', from: FROM, to: TO }]
  const out: Period[] = []
  if (FROM < DESIGN_Y2) out.push({ name: 'y1', from: FROM, to: Math.min(TO, DESIGN_Y2) })
  if (TO > DESIGN_Y2) out.push({ name: 'y2', from: Math.max(FROM, DESIGN_Y2), to: TO })
  return out
}

/** The four check values of 2.13 (entry side). */
const CHECKS = [
  {
    name: 'A',
    market: 'GBPUSD',
    pair: 'H4H1',
    long: false,
    sig: '2026-11-10T07:00Z',
    one: 1.34887,
    zero: 1.33422,
    S: 1.35017,
    E1: 1.34522,
    rr: 2.62,
    w: 41,
    limits: { X1: 132, X3: 104 },
    tom: 2.97,
  },
  {
    name: 'B',
    market: 'XAUUSD',
    pair: 'H4H1',
    long: true,
    sig: '2026-10-21T01:00Z',
    one: 4083.395,
    zero: 4198.821,
    S: 4072.276,
    E1: 4120.082,
    rr: 1.98,
    w: 56,
    limits: { X1: 124, X3: 108 },
    tom: 6.01,
  },
  {
    name: 'C',
    market: 'EURUSD',
    pair: 'DH4',
    long: true,
    sig: '2026-09-22T05:00Z',
    one: 1.13675,
    zero: 1.17115,
    S: 1.13443,
    E1: 1.14582,
    rr: 2.64,
    w: 131,
    limits: { X1: 264, X3: 150 },
    tom: 6.53,
  },
  {
    name: 'D',
    market: 'GBPUSD',
    pair: 'H4H1',
    long: true,
    sig: '2024-11-20T14:00Z',
    one: 1.26269,
    zero: 1.27142,
    S: 1.26111,
    E1: 1.26433,
    rr: 2.57,
    w: 7,
    limits: { X1: 64, X3: 88 },
    tom: 1.55,
  },
] as const

async function main() {
  const head = git('-C', ROOT, 'rev-parse', 'HEAD')
  const dirty = git('-C', ROOT, 'status', '--porcelain').split('\n').filter(Boolean)
  const rec = EXAM ? checkFreeze() : null
  mkdirSync(OUT, { recursive: true })
  const manifest: Record<string, { size: number; sha256: string }> = {}
  for (const m of JM_MARKETS) manifest[h1File(m)] = fileFacts(h1File(m))!
  if (existsSync(join(HISTORY, 'manifest.json')))
    manifest[join(HISTORY, 'manifest.json')] = fileFacts(join(HISTORY, 'manifest.json'))!
  const manifestHash = sha(JSON.stringify(manifest))
  const news: NewsEvent[] = existsSync(NEWS_FILE)
    ? parseNewsCsv(readFileSync(NEWS_FILE, 'utf8'))
    : []
  console.log(
    `reading ${isoMinute(readFrom)} to ${isoMinute(readTo)} (${EXAM ? 'exam' : 'design'} mode)`,
  )
  const data: JmData[] = []
  for (const m of JM_MARKETS)
    data.push(prepareJm(m, await loadWindow(h1File(m), readFrom, readTo), nyCloseBars))
  const byId = new Map(data.map((d) => [d.m.id, d]))
  const basket = makeBasket(data)
  const trading = data.filter((d) => TRADE_MARKETS.includes(d.m.id))
  const per = periods()

  // Signals per structure, period and market.
  const sigCache = new Map<string, Map<JmMarketId, JmSignal[]>>()
  const signalsFor = (pair: JmPair, x: JmExpiry, p: Period) => {
    const key = `${pair}|${x}|${p.name}`
    let got = sigCache.get(key)
    if (!got) {
      got = new Map()
      for (const d of trading)
        got.set(d.m.id, findSignals({ d, pair, expiry: x, from: p.from, to: p.to, basket }).signals)
      sigCache.set(key, got)
    }
    return got
  }

  if (EXAM) return exam(rec!, data, byId, trading, signalsFor, per[0], news, head, manifestHash)

  // 2.13 check values.
  const checks = CHECKS.map((c) => {
    const out: Record<string, unknown> = { name: c.name }
    for (const x of JM_EXPIRIES) {
      const p = per.find(
        (q) => Date.parse(c.sig) / 1000 >= q.from && Date.parse(c.sig) / 1000 < q.to,
      )
      if (!p || !TRADE_MARKETS.includes(c.market)) continue
      const s = signalsFor(c.pair, x, p)
        .get(c.market)!
        .find((q) => isoMinute(q.sigTime) === c.sig && q.long === c.long)
      out[x] = s
        ? {
            found: true,
            one: s.one,
            zero: s.zero,
            S: s.S,
            E1: s.E1,
            planRR: s.planRR,
            w: s.w,
            limit: s.limit,
            travelOverMove: s.travelOverMove,
            x: iso(s.xTime),
            y: iso(s.yTime),
            armedOn: iso(s.jTime),
            fill: iso(s.fillTime),
            check: s.check,
            matches:
              Math.abs(s.one - c.one) < 1e-4 * c.one &&
              Math.abs(s.zero - c.zero) < 1e-4 * c.zero &&
              Math.abs(s.S - c.S) < 1e-4 * c.S &&
              Math.abs((s.E1 ?? 0) - c.E1) < 1e-4 * c.E1 &&
              Math.abs((s.planRR ?? 0) - c.rr) < 0.006 &&
              s.w === c.w &&
              (x === 'X2' ? Math.abs(s.travelOverMove - c.tom) < 0.006 : s.limit === c.limits[x]),
          }
        : { found: false }
    }
    return out
  })
  writeFileSync(join(OUT, 'check-values.json'), JSON.stringify(checks, null, 1))
  console.log(
    'check values:',
    checks
      .map(
        (c) =>
          `${c.name}: ${JM_EXPIRIES.map((x) => ((c[x] as { matches?: boolean })?.matches ? 'ok' : 'NO')).join('/')}`,
      )
      .join(', '),
  )

  // The runs.
  type Res = {
    account: ReturnType<typeof report>
    signal: ReturnType<typeof report>
    signalTrades: JmTrade[]
    accountTrades: JmTrade[]
    csvSha: Record<string, string>
  }
  const results = new Map<string, Record<string, Res>>()
  for (const pair of JM_PAIRS)
    for (const x of JM_EXPIRIES)
      for (const sizing of JM_SIZINGS) {
        const name = variantName(pair, x, sizing)
        if (!VARIANTS.includes(name)) continue
        const dir = join(OUT, name)
        mkdirSync(dir, { recursive: true })
        const byPeriod: Record<string, Res> = {}
        for (const p of per) {
          const sigs = signalsFor(pair, x, p)
          const base = { signals: sigs, pair, expiry: x, sizing, from: p.from, to: p.to, news }
          const acct = simulate({ ...base, data: trading, book: 'account' })
          const sruns = trading.map((d) => simulate({ ...base, data: [d], book: 'signal' }))
          const sigTrades = sruns.flatMap((r) => r.trades)
          const sigRun: JmRun = {
            variant: name,
            book: 'signal',
            trades: sigTrades,
            skips: sruns.flatMap((r) => r.skips),
            signals: sruns.reduce((a, r) => a + r.signals, 0),
            endBalance: JM.startMoney + sigTrades.reduce((a, t) => a + t.netUsd, 0),
            maxDrawdown: drawdownOf(sigTrades),
          }
          const csvSha: Record<string, string> = {}
          for (const [book, run] of [
            ['account', acct],
            ['signal', sigRun],
          ] as const) {
            const text = csv(run.trades)
            const file = `${p.name}-${book}-trades.csv`
            writeFileSync(join(dir, file), text)
            csvSha[file] = sha(text)
          }
          const accountRep = report(acct)
          const signalRep = report(sigRun)
          if (sizing === 'A') {
            const mz = mirrorTest(acct.trades, byId, p.to)
            Object.assign(accountRep, { mirrorZ: mz.z })
          }
          byPeriod[p.name] = {
            account: accountRep,
            signal: signalRep,
            signalTrades: sigTrades,
            accountTrades: acct.trades,
            csvSha,
          }
        }
        results.set(name, byPeriod)
        const summary = {
          variant: name,
          pair: PAIR[pair].label,
          expiry: x,
          sizing,
          codeCommit: head,
          dirtyTree: dirty.length > 0,
          specSha256: fileFacts(SPEC)?.sha256 ?? null,
          dataManifestSha256: manifestHash,
          markets: TRADE_MARKETS,
          periods: Object.fromEntries(
            Object.entries(byPeriod).map(([k, v]) => [
              k,
              {
                window: per.find((q) => q.name === k),
                account: v.account,
                signal: v.signal,
                tradeListSha256: v.csvSha,
              },
            ]),
          ),
        }
        writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 1))
        const y = (k: string) => byPeriod[k]?.account
        console.log(
          `${name}: ${per.map((p) => `${p.name} ${y(p.name)?.trades} trades ${f(y(p.name)?.totalR, 1)}R dd ${f((y(p.name)?.maxDrawdown ?? 0) * 100, 1)}%`).join(' | ')}`,
        )
      }

  if (VARIANTS.length !== ALL_VARIANTS.length || per.length !== 2 || TRADE_MARKETS.length !== 8) {
    console.log('partial run: no pick, no freeze')
    return
  }

  // The pick (section 3).
  const row = (n: string, k: 'y1' | 'y2') => {
    const a = results.get(n)![k].account
    return { trades: a.trades, totalR: a.totalR, maxDrawdown: a.maxDrawdown }
  }
  const rows: StructureRow[] = JM_PAIRS.flatMap((pair) =>
    JM_EXPIRIES.map((expiry) => ({
      pair,
      expiry,
      y1: row(variantName(pair, expiry, 'C'), 'y1'),
      y2: row(variantName(pair, expiry, 'C'), 'y2'),
    })),
  )
  const pick = pickStructure(rows)
  let sizing: 'C' | 'U' = 'C'
  let uVsC = null
  let filters: ReturnType<typeof filterSearch> | null = null
  const filterRuns: Record<string, unknown> = {}
  let odds: Record<string, unknown> | null = null
  if (pick.picked) {
    const { pair, expiry } = pick.picked
    const c = variantName(pair, expiry, 'C')
    const u = variantName(pair, expiry, 'U')
    uVsC = { y1: pairBeats(row(u, 'y1'), row(c, 'y1')), y2: pairBeats(row(u, 'y2'), row(c, 'y2')) }
    if (uVsC.y1.beats && uVsC.y2.beats) sizing = 'U'
    // Filter search (section 5): the control's signal book, both design years.
    const a = results.get(variantName(pair, expiry, 'A'))!
    const fts: FilterTrade[] = (['y1', 'y2'] as const).flatMap((k) =>
      a[k].signalTrades.map(
        (t) =>
          ({
            market: t.market,
            year: k === 'y1' ? 1 : 2,
            r: t.r,
            rDouble: t.rDoubleCost,
            F: t.sig.fields.F,
          }) as FilterTrade,
      ),
    )
    filters = filterSearch(fts)
    // Each survivor: a normal design run, base sizing and control, for the record.
    for (const fl of filters.filter((q) => q.survives)) {
      for (const sz of [sizing, 'A'] as JmSizing[])
        for (const p of per) {
          const run = simulate({
            data: trading,
            signals: signalsFor(pair, expiry, p),
            pair,
            expiry,
            sizing: sz,
            book: 'account',
            from: p.from,
            to: p.to,
            news,
            filters: [fl.filter],
          })
          filterRuns[`${FILTER_NAMES[fl.filter]} ${variantName(pair, expiry, sz)} ${p.name}`] = {
            trades: run.trades.length,
            totalR: sumR(run.trades),
            maxDrawdown: run.maxDrawdown,
          }
        }
    }
    odds = passOdds([
      ...results.get(variantName(pair, expiry, sizing))!.y1.accountTrades,
      ...results.get(variantName(pair, expiry, sizing))!.y2.accountTrades,
    ])
  }
  const all18 = Object.fromEntries(
    [...results].map(([n, v]) => [
      n,
      Object.fromEntries(
        (['y1', 'y2'] as const).map((k) => [
          k,
          {
            trades: v[k].account.trades,
            totalR: v[k].account.totalR,
            avgR: v[k].account.avgR,
            maxDrawdown: v[k].account.maxDrawdown,
            endBalance: v[k].account.endBalance,
            signalBookTrades: v[k].signal.trades,
            signalBookTotalR: v[k].signal.totalR,
          },
        ]),
      ),
    ]),
  )
  const pickOut = {
    picked: pick.picked
      ? { ...pick.picked, sizing, base: variantName(pick.picked.pair, pick.picked.expiry, sizing) }
      : null,
    verdict: pick.picked ? 'confirmed' : 'the design years did not confirm',
    eligibleYear1: pick.eligible,
    candidatesTried: pick.tried,
    uncappedVsCapped: uVsC,
    filters:
      filters?.map((q) => ({
        name: q.name,
        K: q.K,
        D: q.D,
        diff: q.diff,
        p: q.p,
        holm: q.holm,
        lines: q.lines,
        survives: q.survives,
      })) ?? 'not run (no confirmed base)',
    survivorRuns: filterRuns,
    passOdds: odds ?? 'not run (no confirmed base)',
    runs: all18,
  }
  writeFileSync(join(OUT, 'pick.json'), JSON.stringify(pickOut, null, 1))
  writeFileSync(
    join(OUT, 'data-manifest.json'),
    JSON.stringify({ files: manifest, sha256: manifestHash }, null, 1),
  )
  writeFileSync(join(OUT, 'RESULTS.md'), resultsMd(pickOut, all18, checks))
  console.log(`pick: ${pickOut.verdict}${pickOut.picked ? ` -> ${pickOut.picked.base}` : ''}`)

  if (has('freeze')) {
    if (dirty.length) throw new Error(`--freeze needs a clean tree: ${dirty.join('; ')}`)
    const tradeLists: Record<string, string> = {}
    for (const [n, v] of results)
      for (const k of ['y1', 'y2'] as const)
        for (const [file, h] of Object.entries(v[k].csvSha)) tradeLists[`${n}/${file}`] = h
    const record = {
      codeCommit: head,
      spec: { path: SPEC, sha256: fileFacts(SPEC)!.sha256 },
      confirmed: Boolean(pick.picked),
      picked: pickOut.picked
        ? { pair: pickOut.picked.pair, expiry: pickOut.picked.expiry, sizing }
        : null,
      candidatesTried: pick.tried,
      filters: filters?.filter((q) => q.survives).map((q) => q.filter) ?? [],
      filterSearch: pickOut.filters,
      passOdds: pickOut.passOdds,
      files: manifest,
      dataManifestSha256: manifestHash,
      designTradeListsSha256: tradeLists,
      designRuns: all18,
      window: { from: '2019-01-01', to: '2024-11-10' },
      designOutput: OUT,
    }
    const md = `# John's Method: the freeze record\n\nWritten by scripts/lab/johns-method.ts --freeze on ${new Date().toISOString().slice(0, 16)}Z from commit ${head}. The exam run (SPEC.md section 4) reads the json block below and refuses to start unless the tree is clean, nothing but this file changed since the code commit, and SPEC.md and the eight 1-hour files match these hashes.\n\nVerdict of the design years: **${pickOut.verdict}**${pickOut.picked ? `. Base: ${pickOut.picked.base}` : '. There is no exam run'}.\n\n\`\`\`json\n${JSON.stringify(record, null, 1)}\n\`\`\`\n`
    writeFileSync(join(ROOT, FREEZE_FILE), md)
    writeFileSync(join(dirname(OUT), 'FROZEN-BASE.txt'), md)
    console.log(
      `freeze record written: ${FREEZE_FILE} and ${join(dirname(OUT), 'FROZEN-BASE.txt')}`,
    )
  }
}

/**
 * Pass odds (section 6, last note): the base's design trades drawn again
 * 20,000 times into exam-size samples (design trades a year x 5.86 years),
 * under three cases: no edge (R shifted so the average is minus the average
 * cost of a trade), break-even (average 0) and the design average (as is).
 * A draw passes when lines 1, 2, 3, 4, 7 and 8 hold (2% compounding path,
 * 6 equal stretches for the years). Lines 5 and 6 need prices: not drawn.
 */
function passOdds(ts: JmTrade[], runs = 20_000) {
  if (!ts.length) return null
  const rs = ts.map((t) => t.r)
  const dbl = ts.map((t) => t.rDoubleCost)
  const n = Math.max(1, Math.round((ts.length / 2) * 5.86))
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length
  const cost = ts.reduce((a, t) => a + (t.r - t.rDoubleCost), 0) / ts.length
  const cases = { noEdge: -cost - mean, breakEven: -mean, designAverage: 0 }
  const out: Record<string, unknown> = {
    trades: ts.length,
    examSize: n,
    designAvgR: mean,
    avgCostR: cost,
  }
  let seed = 1
  for (const [name, shift] of Object.entries(cases)) {
    const rnd = mulberry(seed++)
    let pass = 0
    for (let r = 0; r < runs; r++) {
      let bal: number = JM.startMoney
      let peak = bal
      let dd = 0
      let sum = 0
      let sumD = 0
      let win = 0
      let loss = 0
      const chunk = new Array(6).fill(0)
      for (let q = 0; q < n; q++) {
        const k = Math.floor(rnd() * rs.length)
        const x = rs[k] + shift
        sum += x
        sumD += dbl[k] + shift
        if (x > 0) win += x
        else loss -= x
        chunk[Math.min(5, Math.floor((q * 6) / n))] += x
        bal *= 1 + JM.fullRisk * x
        peak = Math.max(peak, bal)
        dd = Math.max(dd, (peak - bal) / peak)
      }
      const ok =
        n >= 120 &&
        bal > JM.startMoney &&
        sum / n >= 0.1 &&
        (loss > 0 ? win / loss : Infinity) >= 1.2 &&
        dd <= 0.35 &&
        sumD > 0 &&
        chunk.filter((c) => c > 0).length >= 4
      if (ok) pass++
    }
    out[name] = { shiftR: shift, passShare: pass / runs }
  }
  return out
}

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function resultsMd(
  pick: Record<string, unknown> & {
    verdict: string
    picked: { base: string } | null
    candidatesTried: unknown[]
  },
  runs: Record<
    string,
    Record<string, { trades: number; totalR: number; maxDrawdown: number; endBalance: number }>
  >,
  checks: Record<string, unknown>[],
) {
  const lines = [
    "# John's Method: design years",
    '',
    'Play money research only. These two years chose the version. They are not evidence: only the exam years can be.',
    '',
    `**Result: ${pick.verdict}.**${pick.picked ? ` The base is ${pick.picked.base}.` : ' There is no exam run.'} Candidates tried: ${pick.candidatesTried.length}.`,
    '',
    'Account book, one $10,000 account per year, all 8 markets. R = 2% of the balance at the first entry.',
    '',
    '| Run | Year 1 trades | Year 1 R | Year 1 worst drop | Year 2 trades | Year 2 R | Year 2 worst drop |',
    '|---|---|---|---|---|---|---|',
    ...Object.entries(runs).map(
      ([n, v]) =>
        `| ${n} | ${v.y1.trades} | ${v.y1.totalR.toFixed(1)} | ${(v.y1.maxDrawdown * 100).toFixed(1)}% | ${v.y2.trades} | ${v.y2.totalR.toFixed(1)} | ${(v.y2.maxDrawdown * 100).toFixed(1)}% |`,
    ),
    '',
    `Check values of SPEC 2.13: ${checks.map((c) => `${c.name} ${JM_EXPIRIES.map((x) => ((c[x] as { matches?: boolean })?.matches ? 'ok' : 'differs')).join('/')}`).join(', ')}.`,
    '',
  ]
  return lines.join('\n')
}

/** Exam mode (section 6). Runs only from the freeze commit. */
async function exam(
  rec: JmFreezeRecord,
  data: JmData[],
  byId: Map<JmMarketId, JmData>,
  trading: JmData[],
  signalsFor: (pair: JmPair, x: JmExpiry, p: Period) => Map<JmMarketId, JmSignal[]>,
  p: Period,
  news: NewsEvent[],
  head: string,
  manifestHash: string,
) {
  const { pair, expiry, sizing } = rec.picked!
  const sigs = signalsFor(pair, expiry, p)
  const runOf = (sz: JmSizing, filters?: number[]) =>
    simulate({
      data: trading,
      signals: sigs,
      pair,
      expiry,
      sizing: sz,
      book: 'account',
      from: p.from,
      to: p.to,
      news,
      filters,
    })
  const score = (base: JmRun, control: JmRun, minTrades: number) => {
    const coins = Array.from({ length: 1000 }, (_, k) =>
      coinRun(control.trades, byId, p.from, p.to, k + 1),
    )
    const mz = mirrorTest(control.trades, byId, p.to).z
    const cp = p95(coins)
    const lines = (r: JmRun) =>
      examLines({
        trades: r.trades,
        endBalance: r.endBalance,
        maxDrawdown: r.maxDrawdown,
        minTrades,
        coinP95: cp,
        controlTotalR: sumR(control.trades),
        mirrorZ: mz,
      })
    return {
      base: lines(base),
      control: lines(control),
      coinP95: cp,
      coinAvg: coins.reduce((a, b) => a + b, 0) / coins.length,
      mirrorZ: mz,
    }
  }
  const E1 = runOf(sizing)
  const E2 = runOf('A')
  const E3 = runOf(sizing === 'C' ? 'U' : 'C')
  const main = score(E1, E2, 120)
  const filtered: Record<string, unknown> = {}
  const fl = rec.filters
  const sets = [...fl.map((x) => [x]), ...(fl.length === 2 ? [fl] : [])]
  for (const set of sets) {
    const b = runOf(sizing, set)
    const c = runOf('A', set)
    const sc = score(b, c, 80)
    const sb = stats(b.trades)
    const s1 = stats(E1.trades)
    filtered[set.map((x) => FILTER_NAMES[x]).join(' + ')] = {
      ...sc,
      passes:
        sc.base.verdict === 'pass' && sb.avgR >= s1.avgR + 0.05 && b.maxDrawdown <= E1.maxDrawdown,
    }
  }
  const rowOf = (r: JmRun) => ({
    trades: r.trades.length,
    totalR: sumR(r.trades),
    maxDrawdown: r.maxDrawdown,
  })
  const designBeats = rec.designRuns as Record<
    string,
    Record<'y1' | 'y2', { trades: number; totalR: number; maxDrawdown: number }>
  >
  const bName = variantName(pair, expiry, sizing)
  const aName = variantName(pair, expiry, 'A')
  const beatsAll =
    pairBeats(designBeats[bName].y1, designBeats[aName].y1).beats &&
    pairBeats(designBeats[bName].y2, designBeats[aName].y2).beats &&
    pairBeats(rowOf(E1), rowOf(E2), 17 / 3).beats
  const which =
    main.base.verdict === 'pass' && beatsAll
      ? "John's sizing"
      : main.control.verdict === 'pass'
        ? 'all at once'
        : 'nothing goes forward'
  mkdirSync(OUT, { recursive: true })
  for (const [n, r] of [
    ['E1', E1],
    ['E2', E2],
    ['E3', E3],
  ] as const)
    writeFileSync(join(OUT, `${n}-trades.csv`), csv(r.trades))
  const res = {
    codeCommit: head,
    dataManifestSha256: manifestHash,
    base: bName,
    E1: report(E1),
    E2: report(E2),
    E3: report(E3),
    verdicts: main,
    filtered,
    which,
  }
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(res, null, 1))
  console.log(
    `exam: base ${main.base.verdict}, control ${main.control.verdict}, goes forward: ${which}`,
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
