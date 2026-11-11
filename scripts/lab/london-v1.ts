/**
 * John's London Strategy: the 13 design runs (SPEC.md sections 4 and 5).
 *
 *   npx tsx scripts/lab/london-v1.ts --history DIR --from 2025-11-11 --to 2026-11-10 --out DIR
 *
 * 1-4   v1 with the 4 pre-registered (k, b) pairs, then the pick.
 * 5-8   v1-flip (the ride, then the Fib entry) on the picked k and b, ext x g, then the pick.
 * 9-12  v1-NY on the picked k and b, c x w, then the pick.
 * 13    v1 with thirds on the picked k and b, against the picked v1 run.
 * Each run: one $10,000 account on GBP/USD and gold, the mirror test and
 * 1,000 coin flips (not for thirds, section 5). Writes results.json and
 * results.md to --out. If --out holds build1-ceb7a2b/results.json (the first
 * build's runs), the 4 v1 runs are compared with it trade by trade.
 *
 * Design data only: the loader refuses the clean holdout folder, any file but
 * the 1-minute ones, and any candle before 2025-11-11 00:00 UTC. Play money
 * only: no network, nothing live is touched. See docs/strategy-lab.md.
 *
 * Clean mode (SPEC.md sections 5 and 10), once:
 *
 *   npx tsx scripts/lab/london-v1.ts --clean --history ~/jvd-outputs/trading/history-1m-24mo \
 *     --from 2024-11-11 --to 2025-11-10 --out DIR
 *
 * Before it reads a candle it checks the freeze record (docs/london-v1-freeze.md):
 * a clean working tree, nothing but that file changed since the code commit,
 * SPEC.md, the two 1-minute files and the news list still match their hashes,
 * DIR/FROZEN.txt is the committed record, and DIR has no results yet. It
 * refuses to start otherwise. The settings come from the record, never from
 * this year's results: the other pre-registered runs are context only.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { OHLCCandle } from '../../src/lib/types/market'
import {
  assertCleanFile,
  assertDesignCandles,
  assertDesignFile,
  chartOf,
  CLEAN_END,
  CLEAN_START,
  cleanYear,
  coinRun,
  DESIGN_START,
  evidenceNote,
  FLIP_GRID,
  flipBeatsPlain,
  FREEZE_FILE,
  freezeProblems,
  LONDON_MARKETS,
  mirrorTest,
  NY_GRID,
  nyBreak,
  nyLevels,
  nySessionFor,
  p95,
  parseFreezeRecord,
  passLines,
  pickFlip,
  pickNY,
  pickPair,
  prepareBreak,
  prepareMarket,
  prepareRide,
  rescoreCosts,
  rideSignals,
  runLondon,
  runNY,
  sessionFor,
  summarize,
  thirdsBeats,
  trackDay,
  V1,
  V1_GRID,
  type FreezeRecord,
  type LondonData,
  type LondonMarketId,
  type LondonTrade,
  type RunResult,
} from '../../src/lib/lab/johnsLondon'
import { historyFile, loadCandleFile, loadNews } from '../../src/lib/lab/load'
import { ismEvents } from '../../src/lib/lab/news'
import { DAY, isoMinute } from '../../src/lib/lab/time'

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i > 0 ? process.argv[i + 1] : undefined
  if (!v) throw new Error(`missing --${name}`)
  return v
}

const HISTORY = resolve(arg('history'))
const FROM = Date.parse(`${arg('from')}T00:00:00Z`) / 1000
const TO = Date.parse(`${arg('to')}T00:00:00Z`) / 1000 + DAY // --to is the last day, included
const OUT = resolve(arg('out'))
const COIN_RUNS = 1000
const CLEAN = process.argv.includes('--clean')

if (!Number.isFinite(FROM) || !Number.isFinite(TO) || TO <= FROM) throw new Error('bad --from/--to')
if (!CLEAN) {
  if (FROM < DESIGN_START) throw new Error('design runs start on 2025-11-11 or later')
  if (/history-1m-24mo|history-old/.test(HISTORY))
    throw new Error('refusing the clean or old history')
}

const shaOf = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
function fileFacts(path: string) {
  if (!existsSync(path)) return null
  const buf = readFileSync(path)
  return { size: buf.length, sha256: shaOf(buf) }
}

/** Clean mode: the freeze record's checks (section 5). Throws, before any candle is read, if one fails. */
function checkFreeze(): { rec: FreezeRecord; head: string } {
  const git = (...a: string[]) => execFileSync('git', a, { encoding: 'utf8' }).trim()
  const root = git('rev-parse', '--show-toplevel')
  const md = readFileSync(join(root, FREEZE_FILE), 'utf8')
  const rec = parseFreezeRecord(md)
  let changed: string[] | null
  try {
    changed = git('-C', root, 'diff', '--name-only', rec.codeCommit, 'HEAD')
      .split('\n')
      .filter(Boolean)
  } catch {
    changed = null
  }
  const copy = join(OUT, 'FROZEN.txt')
  const problems = freezeProblems(rec, {
    dirty: git('-C', root, 'status', '--porcelain').split('\n').filter(Boolean),
    changedSinceCode: changed,
    specSha256: fileFacts(rec.spec.path)?.sha256 ?? null,
    files: Object.fromEntries(Object.keys(rec.files).map((p) => [p, fileFacts(p)])),
    copyMatches: existsSync(copy) && readFileSync(copy, 'utf8') === md,
  })
  if (FROM !== CLEAN_START || TO !== CLEAN_END)
    problems.push('--from and --to must be the clean year, 2024-11-11 to 2025-11-10')
  for (const p of [
    ...LONDON_MARKETS.map((id) => historyFile(HISTORY, id, '1m' as never)),
    join(HISTORY, 'news-high-impact.csv'),
  ])
    if (!rec.files[p]) problems.push(`${p} is not in the freeze record`)
  if (existsSync(join(OUT, 'results.json')))
    problems.push(`the clean year was already scored: ${join(OUT, 'results.json')} exists`)
  for (const p of rec.cleanYearScoredBefore ?? [])
    if (!existsSync(p)) problems.push(`the earlier clean scoring ${p} is missing`)
  if (problems.length) throw new Error(`clean run refused:\n- ${problems.join('\n- ')}`)
  return { rec, head: git('rev-parse', 'HEAD') }
}

async function loadYear(id: LondonMarketId): Promise<OHLCCandle[]> {
  const file = historyFile(HISTORY, id, '1m' as never)
  if (CLEAN) {
    assertCleanFile(file, id)
    if (!existsSync(file)) throw new Error(`missing ${file}`)
    return cleanYear(await loadCandleFile(file), file)
  }
  assertDesignFile(file, id)
  if (!existsSync(file)) throw new Error(`missing ${file}`)
  const c = await loadCandleFile(file)
  assertDesignCandles(c, file)
  return c.filter((b) => b.time >= FROM && b.time < TO)
}

const sha = (s: string) => shaOf(s)
const f = (x: number | null | undefined, d = 2) =>
  x == null || !Number.isFinite(x) ? 'n/a' : (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d)
const usd = (x: number) =>
  `${x < 0 ? '-' : ''}$${Math.abs(x)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const hm = (t: number) => isoMinute(t).slice(11, 16)
const when = (t: number) => isoMinute(t).replace('T', ' ').slice(0, 16)
const mName = (m: string) => (m === 'GBPUSD' ? 'GBP/USD' : 'Gold')
const px = (m: string, x: number) => f(x, m === 'GBPUSD' ? 5 : 2)

type Sum = ReturnType<typeof summarize>

interface Scored {
  name: string
  run: RunResult
  summary: Sum
  perMarket: Record<string, Sum>
  perKind: Record<string, Sum>
  buys: Sum
  sells: Sum
  summer: Sum
  winter: Sum
  mirror: { z: number | null; p: number | null; n: number; mirrorTotal: number } | null
  coin: { mean: number; p95: number; beats: number; missed: number } | null
  halfCostsR: number
  doubleCostsR: number
  pass: ReturnType<typeof passLines> | null
  reasons: Record<string, number>
  lateExits: number
  raceExits: number
  tradeListSha256: string
}

function score(name: string, run: RunResult, byId: Map<LondonMarketId, LondonData>): Scored {
  const ts = run.trades
  const s = summarize(ts)
  const thirds = run.options.mode === 'thirds'
  // Section 5: the mirror and the coin flips are not run on the thirds run (it takes v1's signals).
  const mirror = thirds ? null : mirrorTest(ts, byId)
  let coin: Scored['coin'] = null
  let coinP95 = NaN
  if (!thirds) {
    const coins: number[] = []
    let missed = 0
    for (let seed = 1; seed <= COIN_RUNS; seed++) {
      const c = coinRun(ts, byId, seed)
      coins.push(c.total)
      missed += c.missed
    }
    coinP95 = p95(coins)
    coin = {
      mean: sum(coins) / coins.length,
      p95: coinP95,
      beats: coins.filter((x) => x < s.totalR).length / coins.length,
      missed,
    }
  }
  const reasons: Record<string, number> = {}
  for (const o of run.outcomes) {
    const k = `${o.kind}: ${o.result}`
    reasons[k] = (reasons[k] ?? 0) + 1
  }
  const by = (pred: (t: LondonTrade) => boolean) => summarize(ts.filter(pred))
  return {
    name,
    run,
    summary: s,
    perMarket: Object.fromEntries(LONDON_MARKETS.map((m) => [m, by((t) => t.market === m)])),
    perKind: Object.fromEntries(
      (['fib', 'ride', 'break', 'thirds'] as const)
        .filter((k) => ts.some((t) => t.kind === k))
        .map((k) => [k, by((t) => t.kind === k)]),
    ),
    buys: by((t) => t.long),
    sells: by((t) => !t.long),
    summer: by((t) => t.summer),
    winter: by((t) => !t.summer),
    mirror,
    coin,
    halfCostsR: sum(ts.map((t) => rescoreCosts(t, byId.get(t.market)!, 0.5))),
    doubleCostsR: sum(ts.map((t) => rescoreCosts(t, byId.get(t.market)!, 2))),
    pass: thirds
      ? null
      : passLines({
          trades: s.trades,
          endBalance: run.endBalance,
          start: V1.startMoney,
          avgR: s.avgR,
          profitFactor: s.profitFactor,
          maxDrawdown: run.maxDrawdown,
          totalR: s.totalR,
          coinP95,
          mirrorZ: mirror!.z,
        }),
    reasons,
    // Exits more than an hour after their deadline (data stopped before it).
    lateExits: ts.filter((t) => t.exitTime - t.deadline > 3600).length,
    // Trades the 12:45 AST flat rule closed (never expected: every time exit is 12:30 AST or earlier).
    raceExits: ts.filter((t) => t.why === 'race').length,
    tradeListSha256: sha(JSON.stringify(ts)),
  }
}

/** The check values in SPEC.md 2.9 (GBP/USD, k = 2, b = 0.5). */
function checkValues(run: RunResult) {
  const want = [
    { day: '2025-11-14', side: 'BUY', E: 1.31279, stop: 1.30938, rr: 2.5, r: 0.89, why: 'time' },
    { day: '2025-11-26', side: 'SELL', E: 1.31839, stop: 1.32121, rr: 2.5, r: -1.0, why: 'stop' },
    { day: '2026-01-05', side: 'BUY', E: 1.34323, stop: 1.34116, rr: 2.32, r: 2.2, why: 'tp2' },
  ]
  return want.map((w) => {
    const t = run.trades.find((x) => x.market === 'GBPUSD' && x.day === w.day && x.side === w.side)
    const got = t
      ? {
          entry: isoMinute(t.entryTime),
          E: +t.E.toFixed(5),
          stop: +t.stop.toFixed(5),
          distPips: +(t.dist / 0.0001).toFixed(2),
          rr: +t.planRR.toFixed(2),
          exit: isoMinute(t.exitTime),
          why: t.why,
          r: +t.r.toFixed(2),
        }
      : null
    const ok =
      !!got &&
      Math.abs(got.E - w.E) < 1e-5 &&
      Math.abs(got.stop - w.stop) < 1.5e-5 &&
      Math.abs(got.rr - w.rr) < 0.011 &&
      Math.abs(got.r - w.r) < 0.011 &&
      got.why === w.why
    return { want: w, got, ok }
  })
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol

/** M6: the ride check values, entry side only (GBP/USD, k = 2, b = 0.5). */
function rideChecks(gbp: LondonData) {
  const day = Date.parse('2025-11-11T00:00:00Z') / 1000
  const s = sessionFor(day)
  const tr = trackDay(gbp.c15, gbp.atr, s, 2)
  const one = (g: number, hhmm: string, side: 'BUY' | 'SELL') => {
    const r = rideSignals(gbp.market, gbp.c15, tr.setups, 0.5, g).find(
      (x) => hm(x.time) === hhmm && (x.long ? 'BUY' : 'SELL') === side,
    )
    if (!r) return { found: false as const }
    const si = tr.setups[r.setup].signalIdx
    const fibT = si == null ? null : gbp.c15[si].time + 900
    const a = prepareRide(gbp, s, r, 0.272, fibT)
    const b = prepareRide(gbp, s, r, 0.702, fibT)
    if ('why' in a || 'why' in b)
      return { found: true as const, why: 'why' in a ? a.why : (b as { why: string }).why }
    return {
      found: true as const,
      one: +r.one.toFixed(5),
      zero: +r.zero.toFixed(5),
      atr: +r.atr.toFixed(6),
      L: +r.level.toFixed(5),
      size: +r.size.toFixed(2),
      entry: hm(a.entryTime),
      p: +a.p.toFixed(5),
      E: +a.E.toFixed(5),
      distPips: +(a.plan.dist / 1e-4).toFixed(1),
      t272: +a.plan.tp1.toFixed(5),
      rr272: +a.plan.rr.toFixed(2),
      t702: +b.plan.tp1.toFixed(5),
      rr702: +b.plan.rr.toFixed(2),
      limit: hm(a.entryTime + V1.rideLimit),
      setupArmed: hm(gbp.c15[tr.setups[r.setup].armedIdx].time),
    }
  }
  const A = one(1.5, '07:00', 'SELL')
  const B = one(2.5, '13:15', 'BUY')
  const wantA = {
    one: 1.31711,
    zero: 1.31206,
    atr: 0.000754,
    L: 1.31603,
    size: 2.26,
    entry: '07:15',
    p: 1.31288,
    E: 1.31286,
    distPips: 31.7,
    t272: 1.31069,
    rr272: 0.69,
    t702: 1.30851,
    rr702: 1.37,
    limit: '09:15',
  }
  const wantB = {
    one: 1.3116,
    zero: 1.31746,
    atr: 0.000961,
    L: 1.31285,
    size: 2.63,
    entry: '13:30',
    p: 1.31697,
    E: 1.31709,
    distPips: 42.4,
    t272: 1.31905,
    rr272: 0.46,
    t702: 1.32157,
    rr702: 1.06,
    limit: '15:30',
  }
  const cmp = (got: Record<string, unknown>, want: Record<string, number | string>) =>
    Object.entries(want).every(([k, v]) =>
      typeof v === 'string'
        ? got[k] === v
        : near(
            got[k] as number,
            v,
            k === 'distPips'
              ? 0.051
              : k.startsWith('rr') || k === 'size'
                ? 0.0051
                : k === 'atr'
                  ? 6e-7
                  : 6e-6,
          ),
    )
  // In a g = 2.5 run the 07:00 candle gives no ride (size 2.26).
  const aIn25 = rideSignals(gbp.market, gbp.c15, tr.setups, 0.5, 2.5).some(
    (x) => hm(x.time) === '07:00',
  )
  return {
    A: { want: wantA, got: A, ok: 'E' in A && cmp(A, wantA) },
    B: { want: wantB, got: B, ok: 'E' in B && cmp(B, wantB) },
    noRideAt0700WithG25: !aIn25,
  }
}

/** N9: the v1-NY check values, entry side only (c = 15, k = 2, b = 0.5). */
function nyChecks(byId: Map<LondonMarketId, LondonData>) {
  const one = (id: LondonMarketId, dayIso: string, w: boolean) => {
    const d = byId.get(id)!
    const s = nySessionFor(Date.parse(`${dayIso}T00:00:00Z`) / 1000)
    const ch = chartOf(d, 900)
    const lv = nyLevels(d.m1, s)
    if (!lv) return { why: 'no levels' }
    const brk = nyBreak(ch, s, lv, w)
    if (!brk) return { why: 'no break' }
    const r = prepareBreak(d, s, ch, brk, lv, 0.5)
    const dp = id === 'GBPUSD' ? 5 : 2
    const x = (v: number) => +v.toFixed(dp)
    return {
      LH: x(lv.LH),
      LL: x(lv.LL),
      RH: x(lv.RH),
      RL: x(lv.RL),
      BH: x(brk.BH),
      BL: x(brk.BL),
      candle: hm(brk.time),
      side: brk.long ? 'BUY' : 'SELL',
      atr: +ch.atr[brk.i].toFixed(dp + 1),
      ...('why' in r
        ? { why: r.why }
        : {
            entry: hm(r.entryTime),
            p: x(r.p),
            E: x(r.E),
            rawStop: x(r.plan.rawStop),
            dist: x(r.plan.dist),
            stop: x(r.plan.stop),
            target: x(r.plan.tp1),
          }),
    }
  }
  const want = {
    'A off': {
      LH: 1.31551,
      LL: 1.31072,
      RH: 1.31225,
      RL: 1.31046,
      BH: 1.31225,
      BL: 1.31046,
      candle: '13:30',
      side: 'SELL',
      atr: 0.001064,
      entry: '13:45',
      p: 1.30992,
      E: 1.3099,
      rawStop: 1.31278,
      stop: 1.31278,
      target: 1.30558,
    },
    'A on': {
      BH: 1.31551,
      BL: 1.31046,
      candle: '13:30',
      side: 'SELL',
      entry: '13:45',
      E: 1.3099,
      stop: 1.31278,
      target: 1.30558,
    },
    'B off': {
      LH: 4145.73,
      LL: 4124.8,
      RH: 4143.52,
      RL: 4133.68,
      BH: 4143.52,
      BL: 4133.68,
      candle: '14:15',
      side: 'SELL',
      atr: 5.941,
      entry: '14:30',
      p: 4129.89,
      E: 4129.84,
      rawStop: 4146.49,
      dist: 16.65,
      stop: 4146.49,
      target: 4104.87,
    },
    'B on': {
      BH: 4145.73,
      BL: 4124.8,
      candle: '14:45',
      side: 'SELL',
      atr: 7.121,
      entry: '15:00',
      p: 4124.44,
      E: 4124.39,
      rawStop: 4147.08,
      dist: 22.69,
      target: 4090.36,
    },
  } as Record<string, Record<string, number | string>>
  const got: Record<string, Record<string, unknown>> = {
    'A off': one('GBPUSD', '2025-11-12', false),
    'A on': one('GBPUSD', '2025-11-12', true),
    'B off': one('XAUUSD', '2025-11-11', false),
    'B on': one('XAUUSD', '2025-11-11', true),
  }
  return Object.fromEntries(
    Object.keys(want).map((k) => {
      const ok = Object.entries(want[k]).every(([f2, v]) =>
        typeof v === 'string'
          ? got[k][f2] === v
          : near(
              got[k][f2] as number,
              v,
              k.startsWith('A') ? (f2 === 'atr' ? 6e-7 : 1.1e-5) : f2 === 'atr' ? 6e-4 : 0.011,
            ),
      )
      return [k, { want: want[k], got: got[k], ok }]
    }),
  )
}

/** T8: the three 2.9 examples as ladders, from a GBP/USD-only thirds run (entry side only). */
function thirdsChecks(gbp: LondonData) {
  const run = runLondon([gbp], { k: 2, b: 0.5, mode: 'thirds' }, FROM, TO)
  const find = (day: string, side: string) =>
    run.trades.find(
      (t) => t.market === 'GBPUSD' && t.day === day && t.side === side && t.kind === 'thirds',
    )
  const view = (t: LondonTrade | undefined) =>
    t && {
      S: +t.parts![0].stopAtEntry.toFixed(5),
      parts: t.parts!.map((p) => ({ rung: p.rung, at: hm(p.entryTime), E: +p.E.toFixed(5) })),
      stopMove: t.stopMove ? { at: hm(t.stopMove.time), to: +t.stopMove.to.toFixed(5) } : null,
    }
  const A = view(find('2025-11-14', 'BUY'))
  const B = view(find('2025-11-26', 'SELL'))
  const C = view(find('2026-01-05', 'BUY'))
  const okA =
    !!A &&
    near(A.S, 1.30805, 1.1e-5) &&
    A.parts.length === 2 &&
    A.parts[0].rung === 1 &&
    A.parts[0].at === '11:15' &&
    near(A.parts[0].E, 1.31279, 1.1e-5) &&
    A.parts[1].rung === 4 &&
    A.parts[1].at === '11:30' &&
    near(A.parts[1].E, 1.31362, 1.1e-5) &&
    !!A.stopMove &&
    near(A.stopMove.to, 1.31054, 1.1e-5)
  const okB =
    !!B &&
    near(B.S, 1.32235, 1.1e-5) &&
    B.parts.map((p) => `${p.rung}@${p.at}`).join(',') === '1@13:00,2@13:00,3@13:15' &&
    near(B.parts[0].E, 1.31839, 1.1e-5) &&
    near(B.parts[2].E, 1.31938, 1.1e-5) &&
    !B.stopMove
  const okC =
    !!C &&
    near(C.S, 1.34109, 1.1e-5) &&
    C.parts.map((p) => `${p.rung}@${p.at}`).join(',') === '1@13:30,2@13:30,3@13:30' &&
    near(C.parts[0].E, 1.34323, 1.1e-5) &&
    !C.stopMove
  return { A: { got: A, ok: okA }, B: { got: B, ok: okB }, C: { got: C, ok: okC } }
}

/** The 4 v1 runs against the first build (ceb7a2b), trade by trade. */
function compareBuild1(plain: Scored[]) {
  const file = join(OUT, 'build1-ceb7a2b', 'results.json')
  if (!existsSync(file)) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const old = JSON.parse(readFileSync(file, 'utf8')) as { runs: any[] }
  const key = (t: { market: string; entryTime: number; side: string }) =>
    `${t.market}|${t.entryTime}|${t.side}`
  return plain.map((x) => {
    const o = old.runs.find((r) => r.name === x.name)
    if (!o) return { name: x.name, missing: true }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldTrades = o.trades as any[]
    const now = new Map(x.run.trades.map((t) => [key(t), t]))
    const before = new Map(oldTrades.map((t) => [key(t), t]))
    const skipped = oldTrades
      .filter((t) => !now.has(key(t)))
      .map((t) => {
        const out = x.run.outcomes.find(
          (u) => u.market === t.market && u.T === t.T && u.kind === 'fib',
        )
        const other = x.run.trades.find(
          (u) => u.market !== t.market && u.entryTime <= t.entryTime && u.exitTime >= t.entryTime,
        )
        return {
          market: t.market,
          side: t.side,
          entry: isoMinute(t.entryTime),
          firstBuildR: +t.r.toFixed(2),
          firstBuildUsd: +t.usd.toFixed(0),
          why: out?.result ?? 'not found',
          openThen: other
            ? `${mName(other.market)} ${other.side} from ${when(other.entryTime)} to ${when(other.exitTime)}`
            : null,
        }
      })
    const added = x.run.trades
      .filter((t) => !before.has(key(t)))
      .map((t) => ({
        market: t.market,
        side: t.side,
        entry: isoMinute(t.entryTime),
        r: +t.r.toFixed(2),
      }))
    const changed = x.run.trades
      .filter((t) => before.has(key(t)))
      .filter((t) => {
        const b = before.get(key(t))
        return Math.abs(b.r - t.r) > 1e-9 || b.exitTime !== t.exitTime || b.why !== t.why
      })
      .map((t) => ({
        market: t.market,
        side: t.side,
        entry: isoMinute(t.entryTime),
        r: t.r,
        why: t.why,
        firstBuildR: before.get(key(t)).r,
        firstBuildWhy: before.get(key(t)).why,
      }))
    return {
      name: x.name,
      firstBuild: {
        trades: oldTrades.length,
        totalR: o.summary.totalR,
        endBalance: o.endBalance,
        maxDrawdown: o.maxDrawdown,
      },
      now: {
        trades: x.summary.trades,
        totalR: x.summary.totalR,
        endBalance: x.run.endBalance,
        maxDrawdown: x.run.maxDrawdown,
      },
      sameTrades: x.run.trades.length - added.length,
      skipped,
      added,
      changed,
      endedByTheFlatRule: x.raceExits,
    }
  })
}

async function main() {
  const frozen = CLEAN ? checkFreeze() : null
  mkdirSync(OUT, { recursive: true })
  const news = [...(await loadNews(HISTORY)), ...ismEvents(FROM - 30 * DAY, TO + DAY)]
  const data: LondonData[] = []
  for (const id of LONDON_MARKETS) {
    const m1 = await loadYear(id)
    data.push(prepareMarket(id, m1, news))
    console.log(
      `${id}: ${m1.length} one-minute candles, ${isoMinute(m1[0].time)} to ${isoMinute(m1[m1.length - 1].time)}`,
    )
  }
  const byId = new Map(data.map((d) => [d.id, d]))
  const log = (x: Scored) =>
    console.log(
      `${x.name}: ${x.summary.trades} trades, ${f(x.summary.totalR, 1)}R, ${usd(x.run.endBalance)}, DD ${f(x.run.maxDrawdown * 100, 1)}%`,
    )

  // Runs 1-4: v1.
  const plain: Scored[] = []
  for (const k of V1_GRID.k)
    for (const b of V1_GRID.b) {
      const x = score(`v1 k=${k} b=${b}`, runLondon(data, { k, b }, FROM, TO), byId)
      plain.push(x)
      log(x)
    }
  const pick = pickPair(
    plain.map((p) => ({
      k: p.run.options.k as number,
      b: p.run.options.b as number,
      trades: p.summary.trades,
      totalR: p.summary.totalR,
      maxDrawdown: p.run.maxDrawdown,
    })),
  )
  // Clean mode: the frozen settings. The pick rule on this year is reported as context only.
  const fs = frozen?.rec.settings
  const { k, b } = fs ? { k: fs.k, b: fs.b } : pick
  const picked = plain.find((p) => p.run.options.k === k && p.run.options.b === b)!

  // Runs 5-8: v1-flip.
  const flips: Scored[] = []
  for (const ext of FLIP_GRID.ext)
    for (const g of FLIP_GRID.g) {
      const x = score(
        `v1-flip ext=${ext} g=${g}`,
        runLondon(data, { k, b, mode: 'flip', ext, g }, FROM, TO),
        byId,
      )
      flips.push(x)
      log(x)
    }
  const rides = (x: Scored) => x.perKind.ride?.trades ?? 0
  const flipPickHere = pickFlip(
    flips.map((x) => ({
      ext: x.run.options.ext as number,
      g: x.run.options.g as number,
      totalR: x.summary.totalR,
      rides: rides(x),
    })),
  )
  const flipPick = fs ? { ext: fs.ext, g: fs.g } : flipPickHere
  const flipPicked = flips.find(
    (x) => x.run.options.ext === flipPick.ext && x.run.options.g === flipPick.g,
  )!
  const beats = (fl: Scored) =>
    flipBeatsPlain({
      rides: rides(fl),
      ridesR: fl.perKind.ride?.totalR ?? 0,
      flipTotalR: fl.summary.totalR,
      plainTotalR: picked.summary.totalR,
      flipDrawdown: fl.run.maxDrawdown,
      plainDrawdown: picked.run.maxDrawdown,
    })
  // Fib entries of the picked v1 run that the flip run did not take.
  const givenUp = (fl: Scored) => {
    const keys = new Set(
      fl.run.trades.filter((t) => t.kind === 'fib').map((t) => `${t.market}|${t.entryTime}`),
    )
    const lost = picked.run.trades.filter((t) => !keys.has(`${t.market}|${t.entryTime}`))
    return { trades: lost.length, r: sum(lost.map((t) => t.r)) }
  }

  // Runs 9-12: v1-NY.
  const nys: Scored[] = []
  for (const c of NY_GRID.c)
    for (const w of NY_GRID.w) {
      const x = score(
        `v1-NY c=${c} w=${w ? 'on' : 'off'}`,
        runNY(data, { k, b, c, w }, FROM, TO),
        byId,
      )
      nys.push(x)
      log(x)
    }
  const nyPickHere = pickNY(
    nys.map((x) => ({
      c: x.run.options.c as number,
      w: x.run.options.w as boolean,
      trades: x.summary.trades,
      totalR: x.summary.totalR,
      maxDrawdown: x.run.maxDrawdown,
    })),
  )
  const nyPick = fs
    ? { c: fs.c, w: fs.w, qualified: frozen!.rec.designYearQualified?.ny ?? false, eligible: [] }
    : nyPickHere
  const nyPicked = nys.find((x) => x.run.options.c === nyPick.c && x.run.options.w === nyPick.w)!

  // Run 13: v1 with thirds.
  const thirds = score('v1 thirds', runLondon(data, { k, b, mode: 'thirds' }, FROM, TO), byId)
  log(thirds)
  const th = thirds.run.thirds!
  const pair = thirdsBeats({
    ladders: th.ladderTrades,
    thirdsTotalR: thirds.summary.totalR,
    plainTotalR: picked.summary.totalR,
    thirdsDrawdown: thirds.run.maxDrawdown,
    plainDrawdown: picked.run.maxDrawdown,
  })

  const k2 = plain.find((p) => p.run.options.k === 2 && p.run.options.b === 0.5)!
  // The check values and the first-build comparison are design-year days: not run on the clean year.
  const examples = CLEAN ? [] : checkValues(k2.run)
  const noTradeExample = CLEAN
    ? null
    : (k2.run.outcomes.find(
        (o) =>
          o.market === 'GBPUSD' &&
          o.kind === 'fib' &&
          o.T === Date.parse('2025-11-17T11:30:00Z') / 1000,
      ) ?? null)
  const rideCheck = CLEAN ? null : rideChecks(byId.get('GBPUSD')!)
  const nyCheck = CLEAN ? ({} as ReturnType<typeof nyChecks>) : nyChecks(byId)
  const thirdsCheck = CLEAN
    ? ({} as ReturnType<typeof thirdsChecks>)
    : thirdsChecks(byId.get('GBPUSD')!)
  const build1 = CLEAN ? null : compareBuild1(plain)
  const all = [...plain, ...flips, ...nys, thirds]
  const outsideRaceHours = all.map((x) => ({
    name: x.name,
    entriesRefused: x.run.outcomes.filter((o) => o.result === 'outside race hours').length,
    endedByTheFlatRule: x.raceExits,
  }))

  const seenBefore = frozen?.rec.cleanYearScoredBefore ?? []
  const evidence = evidenceNote(CLEAN ? 'clean' : 'design', seenBefore.length)
  const json = {
    strategy: "John's London Strategy v1, v1-flip, v1-NY and thirds",
    evidence,
    cleanYearScoredBefore: CLEAN ? seenBefore : undefined,
    spec: '~/jvd-outputs/2026-11-11/london-strategy/SPEC.md',
    data: {
      history: HISTORY,
      from: isoMinute(FROM),
      toExclusive: isoMinute(TO),
      markets: LONDON_MARKETS,
      skipped: [
        { market: 'EURGBP', why: 'out of v1 (SPEC 2.2)' },
        { market: 'US30', why: 'later (SPEC 8): no design-year 1-minute history' },
      ],
    },
    rules: V1,
    selection: frozen
      ? {
          frozen: true,
          freezeRecord: FREEZE_FILE,
          codeCommit: frozen.rec.codeCommit,
          runCommit: frozen.head,
          v1: { k, b, designYearQualified: frozen.rec.designYearQualified?.v1 ?? null },
          flip: flipPick,
          ny: { c: nyPick.c, w: nyPick.w, designYearQualified: nyPick.qualified },
          thirds: 'nothing is picked',
          contextOnlyPickRuleOnThisYear: { v1: pick, flip: flipPickHere, ny: nyPickHere },
        }
      : {
          v1: { k, b, qualified: pick.qualified, eligible: pick.eligible },
          flip: flipPick,
          ny: { c: nyPick.c, w: nyPick.w, qualified: nyPick.qualified, eligible: nyPick.eligible },
          thirds: 'nothing is picked',
        },
    verdicts: frozen
      ? {
          v1: picked.pass,
          flipBeatsPlain: beats(flipPicked),
          flipOwnSixLines: flipPicked.pass,
          ny: nyPicked.pass,
          nyLabel: nyPick.qualified ? null : 'the design year did not qualify',
          thirdsBeatsAllAtOnce: pair,
        }
      : undefined,
    [CLEAN ? 'flipBeatsPlainOnCleanYear' : 'flipBeatsPlainOnDesignYear']: Object.fromEntries(
      flips.map((x) => [x.name, beats(x)]),
    ),
    [CLEAN ? 'thirdsBeatsAllAtOnceOnCleanYear' : 'thirdsBeatsAllAtOnceOnDesignYear']: pair,
    oldStopAndReverseFlip:
      'dropped from scoring; design year +$1,602 against v1 +$4,913 (first build, ceb7a2b)',
    checkValues: {
      v1: examples,
      noTradeExample,
      rides: rideCheck,
      ny: nyCheck,
      thirds: thirdsCheck,
    },
    firstBuildComparison: build1,
    raceHours: outsideRaceHours,
    runs: all.map((x) => ({
      name: x.name,
      strategy: x.run.strategy,
      options: x.run.options,
      signals: x.run.signals,
      rideSignals: x.run.rideSignals,
      breaks: x.run.breaks,
      endBalance: x.run.endBalance,
      maxDrawdown: x.run.maxDrawdown,
      maxOpenSeen: x.run.maxOpenSeen,
      maxOpenRiskSeen: x.run.maxOpenRiskSeen,
      summary: x.summary,
      perMarket: x.perMarket,
      perKind: x.perKind,
      buys: x.buys,
      sells: x.sells,
      summer: x.summer,
      winter: x.winter,
      mirror: x.mirror,
      coinFlips: x.coin ? { runs: COIN_RUNS, ...x.coin } : null,
      halfCostsR: x.halfCostsR,
      doubleCostsR: x.doubleCostsR,
      passLinesOnDesignYear: x.pass,
      flipBeatsPlain: x.run.options.mode === 'flip' ? beats(x) : undefined,
      givenUpFibEntries: x.run.options.mode === 'flip' ? givenUp(x) : undefined,
      thirds: x.run.thirds,
      londonLines: x.run.lines,
      noTradeReasons: x.reasons,
      lateExits: x.lateExits,
      raceExits: x.raceExits,
      tradeListSha256: x.tradeListSha256,
      trades: x.run.trades,
    })),
  }
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(json, null, 1))

  // ── results.md, plain English ──
  const L: string[] = []
  const row = (name: string, x: Scored) => {
    const s = x.summary
    return `| ${name} | ${s.trades} | ${f(s.winRate * 100, 0)}% | ${usd(x.run.endBalance - V1.startMoney)} | ${f(s.profitFactor)} | ${f(x.run.maxDrawdown * 100, 1)}% | ${f(s.avgR)}R | ${f(s.totalR, 1)}R |`
  }
  const head =
    '| Run | Trades | Win rate | $ result | Profit factor | Max drop | Average | Total |\n|---|---|---|---|---|---|---|---|'
  L.push(`# John's London strategies: ${CLEAN ? 'clean year' : 'design year'} results`, '')
  L.push(
    CLEAN
      ? `Clean year, ${arg('from')} to ${arg('to')} (UTC), scored ${seenBefore.length ? 'again' : 'once'} with the settings of the freeze record (${FREEZE_FILE}, code ${frozen!.rec.codeCommit}, run from ${frozen!.head}). GBP/USD and gold, one $10,000 play account per run, 2% risk a trade. Only the frozen runs count. The other pre-registered runs are context and change nothing.`
      : `Design data only, ${arg('from')} to ${arg('to')} (UTC). GBP/USD and gold, one $10,000 play account per run, 2% risk a trade. Not the verdict: the clean year is scored later, once.`,
    '',
    `**${evidence}**`,
    '',
  )
  if (frozen) {
    const vl = (p: Scored['pass']) =>
      p
        ? `${p.lines.map((l) => `${l.line} ${l.ok ? 'yes' : 'no'}`).join(', ')}. ${p.verdict}`
        : 'n/a'
    L.push('## Verdicts (frozen settings)', '')
    L.push(`- v1 k = ${k}, b = ${b}: ${vl(picked.pass)}.`)
    L.push(
      `- v1-flip ext = ${flipPick.ext}, g = ${flipPick.g}: flip beats plain ${beats(flipPicked).beats ? 'yes' : 'no'} (${beats(
        flipPicked,
      )
        .checks.map((c) => `${c.text}: ${c.ok ? 'yes' : 'no'}`)
        .join('; ')}). Its own six lines: ${vl(flipPicked.pass)}.`,
    )
    L.push(
      `- v1-NY c = ${nyPick.c}, w = ${nyPick.w ? 'on' : 'off'}${nyPick.qualified ? '' : ' (the design year did not qualify)'}: ${vl(nyPicked.pass)}.`,
    )
    L.push(
      `- Thirds beats all at once: ${pair.beats ? 'yes' : 'no'} (${pair.checks.map((c) => `${c.text}: ${c.ok ? 'yes' : 'no'}`).join('; ')}).`,
      '',
    )
  }
  L.push(
    frozen ? '## What the pick rule would say on this year (context only)' : '## The picks',
    '',
  )
  const flipPickShown = flipPickHere
  const nyPickShown = nyPickHere
  L.push(
    pick.qualified
      ? `- v1: k = ${pick.k}, b = ${pick.b}. ${pick.eligible.length} of 4 pairs were eligible (100 or more trades, max drop 25% or less).`
      : `- v1: the ${CLEAN ? 'clean' : 'design'} year did not qualify. The defaults are used: k = ${pick.k}, b = ${pick.b}.`,
  )
  L.push(
    `- v1-flip: ext = ${flipPickShown.ext}, g = ${flipPickShown.g}. Flip beats plain on the ${CLEAN ? 'clean' : 'design'} year: ${beats(flipPicked).beats ? 'yes' : 'no'}.`,
  )
  L.push(
    nyPickShown.qualified
      ? `- v1-NY: c = ${nyPickShown.c}, w = ${nyPickShown.w ? 'on' : 'off'}. ${nyPickShown.eligible.length} of 4 were eligible.`
      : `- v1-NY: the ${CLEAN ? 'clean' : 'design'} year did not qualify. The defaults are used: c = ${nyPickShown.c}, w = ${nyPickShown.w ? 'on' : 'off'}.`,
  )
  L.push(
    `- Thirds: nothing is picked. Thirds beats all at once on the ${CLEAN ? 'clean' : 'design'} year: ${pair.beats ? 'yes' : 'no'} (${pair.checks.map((c) => `${c.text}: ${c.ok ? 'yes' : 'no'}`).join('; ')}).`,
    '',
  )
  L.push('## v1, the four settings', '', head)
  for (const x of plain) L.push(row(x.name, x))
  L.push('', '## v1-flip (picked k and b)', '', head)
  L.push(row(`v1 k=${k} b=${b}`, picked))
  for (const x of flips) L.push(row(x.name, x))
  L.push('')
  for (const x of flips) {
    const bp = beats(x)
    const gu = givenUp(x)
    const r = x.perKind.ride
    const fb = x.perKind.fib
    L.push(
      `**${x.name}.** Ride signals ${x.run.rideSignals}. Rides: ${r?.trades ?? 0}, ${f(r?.totalR ?? 0, 1)}R (${usd(r?.usd ?? 0)}). Fib entries: ${fb?.trades ?? 0}, ${f(fb?.totalR ?? 0, 1)}R. It gave up ${gu.trades} Fib entries of v1 worth ${f(gu.r, 1)}R. Flip beats plain: ${bp.beats ? 'yes' : 'no'} (${bp.checks.map((c) => `${c.text}: ${c.ok ? 'yes' : 'no'}`).join('; ')}).`,
      '',
    )
  }
  L.push(
    "The old stop-and-reverse flip is dropped from scoring. On the design year it made +$1,602 against v1's +$4,913 (first build).",
    '',
  )
  L.push('## v1-NY (picked k and b), its own account', '', head)
  for (const x of nys) L.push(row(x.name, x))
  L.push('')
  for (const x of nys) {
    const br = x.perKind.break
    const fb = x.perKind.fib
    L.push(
      `**${x.name}.** Breaks seen ${x.run.breaks}. Break trades: ${br?.trades ?? 0}, ${f(br?.totalR ?? 0, 1)}R. Fib entries: ${fb?.trades ?? 0}, ${f(fb?.totalR ?? 0, 1)}R.`,
      '',
    )
  }
  const lines = nys[0].run.lines!
  L.push(
    "London's lines (N8), candles from 08:00 to 11:00 New York, 15-minute chart: the first candle that trades past London's high or low.",
    '',
  )
  L.push(
    '| Market | Line | Closed past it (break) | Closed back inside (rejection) | Not touched |',
    '|---|---|---|---|---|',
  )
  for (const m of LONDON_MARKETS)
    for (const side of ['high', 'low'] as const) {
      const c = lines[m]?.[side]
      if (c)
        L.push(`| ${mName(m)} | London ${side} | ${c.breaks} | ${c.rejections} | ${c.untouched} |`)
    }
  const l5 = nys.find((x) => x.run.options.c === 5)?.run.lines
  if (l5) {
    L.push(
      '',
      'The same on the 5-minute chart:',
      '',
      '| Market | Line | Break | Rejection | Not touched |',
      '|---|---|---|---|---|',
    )
    for (const m of LONDON_MARKETS)
      for (const side of ['high', 'low'] as const) {
        const c = l5[m]?.[side]
        if (c)
          L.push(
            `| ${mName(m)} | London ${side} | ${c.breaks} | ${c.rejections} | ${c.untouched} |`,
          )
      }
  }
  L.push('', '## v1 with thirds against all at once (picked k and b)', '', head)
  L.push(row(`v1 k=${k} b=${b} (all at once)`, picked))
  L.push(row('v1 thirds', thirds))
  L.push(
    '',
    `Signals taken: ${th.taken}. Confident (all at once): ${th.confident}. Ladders: ${th.ladders}, of which ${th.ladderTrades} opened a part. Thirds opened: ${th.thirdsOpened.join(', ')} (rungs 1, 2, 3). Adds tried ${th.addsTried}, opened ${th.addsOpened}. Price traded past 1 before any turn candle: ${th.pastOneBeforeTurn}. How ladders ended: ${Object.entries(
      th.ends,
    )
      .map(([w, n]) => `${w} ${n}`)
      .join(', ')}.`,
    '',
  )
  const detail = (x: Scored) => {
    L.push(`### ${x.name}`, '')
    L.push(
      `Signals ${x.run.signals}, trades ${x.summary.trades}. $10,000 became ${usd(x.run.endBalance)}.`,
      '',
    )
    L.push(
      '| Part | Trades | Win rate | Average | Total | Profit factor | $ |',
      '|---|---|---|---|---|---|---|',
    )
    const part = (n: string, s: Sum) =>
      L.push(
        `| ${n} | ${s.trades} | ${f(s.winRate * 100, 0)}% | ${f(s.avgR)}R | ${f(s.totalR, 1)}R | ${f(s.profitFactor)} | ${usd(s.usd)} |`,
      )
    for (const m of LONDON_MARKETS) part(mName(m), x.perMarket[m])
    const kindName = {
      fib: 'Fib entries',
      ride: 'Rides',
      break: 'Break trades',
      thirds: 'Thirds trades',
    } as const
    if (Object.keys(x.perKind).length > 1)
      for (const [kk, s] of Object.entries(x.perKind))
        part(kindName[kk as keyof typeof kindName], s)
    part('Buys', x.buys)
    part('Sells', x.sells)
    const season = x.run.strategy === 'ny' ? 'US' : 'UK'
    part(`${season} summer`, x.summer)
    part(`${season} winter`, x.winter)
    L.push('')
    const drag = LONDON_MARKETS.filter((m) => x.perMarket[m].trades >= 30 && x.perMarket[m].usd < 0)
    if (x.mirror)
      L.push(
        `- Mirror (every trade the other way): ${f(x.mirror.mirrorTotal, 1)}R, z = ${f(x.mirror.z)}.`,
      )
    if (x.coin)
      L.push(
        `- Coin flips (1,000 runs): average ${f(x.coin.mean, 1)}R, 95th percentile ${f(x.coin.p95, 1)}R. The real total beat ${f(x.coin.beats * 100, 0)}% of them.`,
      )
    L.push(`- At half costs ${f(x.halfCostsR, 1)}R, at double costs ${f(x.doubleCostsR, 1)}R.`)
    L.push(
      `- Without the 3 best trades: ${f(x.summary.withoutBest3R, 1)}R. Longest losing run: ${x.summary.longestLosingRun} trades. Ended on a clock close (time, news, 2-hour limit, Fib close): ${f(x.summary.timeOrNewsShare * 100, 0)}%.`,
    )
    L.push(
      `- Average loser: ${f(x.summary.avgLossPct)}% of the balance. Average winner: +${f(x.summary.avgWinPct)}%.`,
    )
    if (drag.length)
      L.push(`- Drag (30 or more trades and a net loss): ${drag.map(mName).join(', ')}.`)
    if (x.pass)
      L.push(
        `- The six pass lines, on this ${CLEAN ? 'clean year' : 'design year (for information only)'}: ${x.pass.lines.map((l) => `${l.line} ${l.ok ? 'yes' : 'no'}`).join(', ')}. Reads as: ${x.pass.verdict}.`,
      )
    L.push('')
  }
  L.push('## Each run', '')
  for (const x of all) detail(x)

  if (!CLEAN) L.push('## The first build against this one (v1, the four settings)', '')
  if (!build1) {
    if (!CLEAN) L.push('No first-build results were found next to this run.', '')
  } else
    for (const c of build1) {
      if ('missing' in c) continue
      L.push(
        `**${c.name}.** First build ${c.firstBuild.trades} trades, ${f(c.firstBuild.totalR, 1)}R, ${usd(c.firstBuild.endBalance)}. Now ${c.now.trades} trades, ${f(c.now.totalR, 1)}R, ${usd(c.now.endBalance)}. The same ${c.sameTrades} trades with the same R. Skipped by the dollar bet: ${c.skipped.length}. New trades: ${c.added.length}. Trades with a different exit: ${c.changed.length}. Ended early by the 12:45 rule: ${c.endedByTheFlatRule}.`,
        '',
      )
      for (const s of c.skipped)
        L.push(
          `- Skipped: ${mName(s.market)} ${s.side} at ${s.entry.replace('T', ' ').slice(0, 16)} UTC (first build ${f(s.firstBuildR)}R, ${usd(s.firstBuildUsd)}). Why: ${s.why}. Open then: ${s.openThen ?? 'n/a'}.`,
        )
      L.push('')
    }
  if (rideCheck) {
    L.push('## Check values', '')
    for (const e of examples)
      L.push(
        `- 2.9 ${e.want.day} ${e.want.side}: ${e.ok ? 'matches' : 'DIFFERS'}. Spec: fill ${e.want.E}, stop ${e.want.stop}, plan ${e.want.rr}R, ${e.want.why}, ${e.want.r}R. Code: ${e.got ? `fill ${e.got.E}, stop ${e.got.stop}, plan ${e.got.rr}R, ${e.got.why} at ${e.got.exit}, ${e.got.r}R` : 'no trade'}.`,
      )
    L.push(
      `- 2.9 2025-11-17 SELL signal at 11:15: ${noTradeExample ? noTradeExample.result : 'no signal found'} (spec: no trade, plan under 1.5R).`,
    )
    L.push(
      `- M6 ride A: ${rideCheck.A.ok ? 'matches' : 'DIFFERS'} ${JSON.stringify(rideCheck.A.got)}`,
    )
    L.push(
      `- M6 ride B: ${rideCheck.B.ok ? 'matches' : 'DIFFERS'} ${JSON.stringify(rideCheck.B.got)}`,
    )
    L.push(`- M6: no ride at 07:00 with g = 2.5: ${rideCheck.noRideAt0700WithG25 ? 'yes' : 'NO'}`)
    for (const [kk, v] of Object.entries(nyCheck))
      L.push(`- N9 break ${kk}: ${v.ok ? 'matches' : 'DIFFERS'} ${JSON.stringify(v.got)}`)
    for (const [kk, v] of Object.entries(thirdsCheck))
      L.push(`- T8 example ${kk}: ${v.ok ? 'matches' : 'DIFFERS'} ${JSON.stringify(v.got)}`)
    L.push('')
  }
  L.push(
    `Race hours (02:00 to 12:30 AST entries, flat at 12:45 AST): ${outsideRaceHours.every((r) => !r.entriesRefused && !r.endedByTheFlatRule) ? 'no entry was refused and no trade was ended by them in any run' : JSON.stringify(outsideRaceHours)}.`,
    '',
  )

  const tradeTable = (x: Scored) => {
    L.push(`### Trades: ${x.name}`, '')
    L.push(
      '| # | Market | Kind | Side | Entry (UTC) | Fill | Stop | Plan | Exit (UTC) | How | R | $ |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|',
    )
    for (const t of x.run.trades)
      L.push(
        `| ${t.id + 1} | ${mName(t.market)} | ${t.kind}${t.parts ? ` (${t.parts.length} parts)` : ''} | ${t.side} | ${when(t.entryTime)} | ${px(t.market, t.E)} | ${px(t.market, t.stop)} | ${f(t.planRR)}R | ${when(t.exitTime)} | ${t.why}${t.tp1Hit && t.why !== 'tp2' ? ' (half at 0)' : ''} | ${f(t.r)} | ${usd(t.usd)} |`,
      )
    L.push('')
  }
  L.push(`## Trade lists (${CLEAN ? 'frozen' : 'picked'} settings)`, '')
  tradeTable(picked)
  tradeTable(flipPicked)
  tradeTable(nyPicked)
  tradeTable(thirds)
  L.push(
    'Every trade of every run is in results.json, with each thirds part and the stop move.',
    '',
  )
  writeFileSync(join(OUT, 'results.md'), L.join('\n'))

  console.log(
    `${CLEAN ? 'frozen' : 'picked'} v1 k=${k} b=${b} (qualified ${pick.qualified}); flip ext=${flipPick.ext} g=${flipPick.g}; NY c=${nyPick.c} w=${nyPick.w} (qualified ${nyPick.qualified})`,
  )
  console.log(
    `flip beats plain: ${beats(flipPicked).beats}; thirds beats all at once: ${pair.beats}`,
  )
  for (const e of examples) console.log(`2.9 ${e.want.day}: ${e.ok ? 'ok' : 'DIFFERS'}`)
  if (rideCheck)
    console.log(
      `M6 A ${rideCheck.A.ok} B ${rideCheck.B.ok} noRideA@2.5 ${rideCheck.noRideAt0700WithG25}`,
    )
  for (const [kk, v] of Object.entries(nyCheck)) console.log(`N9 ${kk}: ${v.ok}`)
  for (const [kk, v] of Object.entries(thirdsCheck)) console.log(`T8 ${kk}: ${v.ok}`)
  console.log(`wrote ${join(OUT, 'results.json')} and results.md`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
