/**
 * Strategy lab runner: every bot, walk-forward, in parallel worker processes.
 *
 *   make lab                                   (runs this, then the report)
 *   npx tsx scripts/lab/run.ts [--out DIR] [--workers N] [--only TEXT]
 *
 * Reads ~/jvd-outputs/trading/history (override with LAB_HISTORY), writes
 * results.json, ranking.csv and ranking.md to ~/jvd-outputs/<today>/strategy-lab
 * (or --out). Play money only: no network, no accounts, nothing live is touched.
 * See docs/strategy-lab.md.
 */
import { fork, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, homedir } from 'node:os'
import { join } from 'node:path'
import {
  allBotSpecs,
  botName,
  PARAM_WORDS,
  type BotDetail,
  type BotResult,
  type BotSpec,
  type EnsemblePart,
} from '../../src/lib/lab/bots'
import { LAB_MARKETS, NEWS_X, REOPEN_X, ROLLOVER_X, TF_SEC } from '../../src/lib/lab/markets'
import { NEWS_PAD_SEC, NEWS_WORDS } from '../../src/lib/lab/news'
import { bonferroniZ, holm, signTest } from '../../src/lib/lab/stats'
import { STYLE_WORDS } from '../../src/lib/lab/time'
import { IS_SHARE, MIN_IS_TRADES, MIN_OOS_TRADES, START_MONEY } from '../../src/lib/lab/walkforward'
import { RACE_SIZING } from '../../src/lib/race/account'
import type { LabJob } from './worker'

type Job = LabJob extends infer J ? (J extends { id: number } ? Omit<J, 'id'> : never) : never

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

const localDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const OUT = arg('out') ?? join(homedir(), 'jvd-outputs', localDate(), 'strategy-lab')
// Leave cores for the live race jobs and the desktop.
const WORKERS = Number(arg('workers') ?? Math.max(1, Math.min(7, cpus().length - 3)))
const ONLY = arg('only')

class Pool {
  private queue: { job: Job; resolve: (v: unknown) => void; reject: (e: Error) => void }[] = []
  private idle: ChildProcess[] = []
  private all: ChildProcess[] = []
  private nextId = 1
  private waiting = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; w: ChildProcess }
  >()

  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const w = fork(join(__dirname, 'worker.ts'), [], { execArgv: ['--import', 'tsx'] })
      this.all.push(w)
      w.on('message', (msg: { kind: string; id?: number; result?: unknown; error?: string }) => {
        if (msg.kind === 'ready') {
          this.idle.push(w)
          this.pump()
          return
        }
        const p = this.waiting.get(msg.id!)
        if (!p) return
        this.waiting.delete(msg.id!)
        if (msg.kind === 'done') p.resolve(msg.result)
        else p.reject(new Error(msg.error))
        this.idle.push(w)
        this.pump()
      })
      w.on('exit', (code) => {
        if (code)
          for (const [, p] of this.waiting)
            if (p.w === w) p.reject(new Error(`worker exited ${code}`))
      })
    }
  }

  run<T>(job: Job): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ job, resolve: resolve as (v: unknown) => void, reject })
      this.pump()
    })
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.shift()!
      const { job, resolve, reject } = this.queue.shift()!
      const id = this.nextId++
      this.waiting.set(id, { resolve, reject, w })
      w.send({ ...job, id })
    }
  }

  close() {
    for (const w of this.all) w.send({ kind: 'exit' })
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const r2 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 100) / 100)
const r4 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 10_000) / 10_000)
const familyKey = (b: Pick<BotResult, 'variant' | 'tf' | 'style' | 'scope'>) =>
  `${b.variant}|${b.tf}-${b.style}|${b.scope}`
/** Strategy family for "at most 2 per family": all Fib versions are one, both London versions one, each rule its own. */
const strategyFamily = (b: Pick<BotResult, 'family' | 'variant'>) =>
  b.family === 'fib' ? 'fib' : b.family === 'london' ? 'london' : b.variant
/** Lower of the in-sample and out-of-sample per-signal t: it needs BOTH halves to be good. */
const bothT = (b: BotResult) => Math.min(b.sig?.is.t ?? -99, b.sig?.oos.t ?? -99)

/**
 * The top 5 for the live race (rule fixed before any result was seen,
 * 2026-11-11): at least 30 out-of-sample trades, out-of-sample drawdown
 * under 25%, in-sample profit factor at least 1 and the out-of-sample one at
 * most 0.5 above it (a small in/out gap), ranked by out-of-sample profit
 * factor (ties: out-of-sample net), copies merged, at most 2 per strategy
 * family. If no Fib made it but one qualifies, the best qualifying Fib takes
 * the 5th place. Never reads the holdout.
 */
function pickTop5(distinct: BotResult[]) {
  const pf = (x: number | null) => x ?? Infinity
  const ok = distinct.filter(
    (b) =>
      b.family !== 'control' &&
      b.family !== 'ensemble' &&
      b.eligible &&
      b.oos.maxDrawdownPct < 25 &&
      b.is.profitFactor != null &&
      b.is.profitFactor >= 1 &&
      b.oos.profitFactor != null &&
      b.oos.profitFactor <= b.is.profitFactor + 0.5,
  )
  const sorted = [...ok].sort(
    (a, b) => pf(b.oos.profitFactor) - pf(a.oos.profitFactor) || b.oos.net - a.oos.net,
  )
  const top: BotResult[] = []
  const per = new Map<string, number>()
  // News versions of the same strategy, chart and market count once (added
  // after the first look at the list: two near-copies would waste a race slot).
  const usedBot = new Set<string>()
  for (const b of sorted) {
    const f = strategyFamily(b)
    const one = familyKey(b)
    if ((per.get(f) ?? 0) >= 2 || usedBot.has(one)) continue
    usedBot.add(one)
    per.set(f, (per.get(f) ?? 0) + 1)
    top.push(b)
    if (top.length === 5) break
  }
  const bestFib = sorted.find((b) => b.family === 'fib') ?? null
  let fibSwapped = false
  if (bestFib && !top.some((b) => b.family === 'fib')) {
    if (top.length === 5) top.pop()
    top.push(bestFib)
    fibSwapped = true
  }
  return { top, qualified: ok.length, bestFib, fibSwapped }
}

function newsEffect(bots: BotResult[]) {
  // One row per strategy x chart x single market (the "all" accounts repeat
  // those markets), copies dropped: a fairer count than every pair.
  const groups = new Map<string, Partial<Record<string, BotResult>>>()
  for (const b of bots) {
    if (b.scope === 'all' || b.family === 'control' || b.family === 'ensemble') continue
    const g = groups.get(familyKey(b)) ?? {}
    g[b.news] = b
    groups.set(familyKey(b), g)
  }
  const out: Record<string, unknown> = {}
  for (const mode of ['block', 'close', 'day']) {
    const diffs: { family: string; diff: number; off: number; on: number; same: boolean }[] = []
    for (const [k, g] of groups) {
      const off = g.off
      const on = g[mode]
      if (!off || !on) continue
      diffs.push({
        family: k,
        diff: on.oos.net - off.oos.net,
        off: off.oos.net,
        on: on.oos.net,
        same: on.extras?.sig === off.extras?.sig,
      })
    }
    if (!diffs.length) continue
    const changed = diffs.filter((d) => !d.same)
    const better = changed.filter((d) => d.diff > 0).length
    const worse = changed.filter((d) => d.diff < 0).length
    out[mode] = {
      words: NEWS_WORDS[mode as 'block'],
      pairs: diffs.length,
      identical: diffs.length - changed.length,
      better,
      worse,
      signTestP: r4(signTest(better, better + worse)),
      medianDiff: r2(median(changed.map((d) => d.diff))),
      meanDiff: r2(changed.length ? changed.reduce((a, d) => a + d.diff, 0) / changed.length : 0),
      biggest: [...changed]
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
        .slice(0, 8)
        .map((d) => ({ ...d, diff: r2(d.diff), off: r2(d.off), on: r2(d.on) })),
    }
  }
  return out
}

function familySummary(bots: BotResult[]) {
  const rows = new Map<string, BotResult[]>()
  for (const b of bots) rows.set(b.variant, [...(rows.get(b.variant) ?? []), b])
  return [...rows.entries()].map(([variant, bs]) => {
    const el = bs.filter((b) => b.eligible)
    const best = [...el].sort((a, b) => bothT(b) - bothT(a))[0]
    return {
      variant,
      name: botName({ family: bs[0].family, variant, tf: bs[0].tf }),
      family: bs[0].family,
      bots: bs.length,
      eligible: el.length,
      positiveOos: el.filter((b) => b.oos.net > 0).length,
      positiveBoth: el.filter((b) => b.oos.net > 0 && b.is.net > 0).length,
      medianOosR: r4(median(el.map((b) => b.sig?.oos.meanR ?? 0))),
      medianIsR: r4(median(el.map((b) => b.sig?.is.meanR ?? 0))),
      medianOosPerMonth: r2(median(el.map((b) => b.oos.perMonth))),
      best: best ? { id: best.id, bothT: r2(bothT(best)), oosNet: r2(best.oos.net) } : null,
    }
  })
}

function fibSummary(bots: BotResult[]) {
  const fib = bots.filter((b) => b.family === 'fib')
  const by = (key: (b: BotResult) => string) => {
    const m = new Map<string, BotResult[]>()
    for (const b of fib) m.set(key(b), [...(m.get(key(b)) ?? []), b])
    return [...m.entries()].map(([k, bs]) => {
      const el = bs.filter((b) => b.eligible)
      return {
        key: k,
        bots: bs.length,
        eligible: el.length,
        positiveOos: el.filter((b) => b.oos.net > 0).length,
        positiveBoth: el.filter((b) => b.oos.net > 0 && b.is.net > 0).length,
        medianOosPerMonth: r2(median(el.map((b) => b.oos.perMonth))),
        medianOosWinRate: r2(median(el.map((b) => b.oos.winRate ?? 0))),
        medianIsR: r4(median(bs.map((b) => b.sig?.is.meanR ?? 0))),
        medianOosR: r4(median(bs.map((b) => b.sig?.oos.meanR ?? 0))),
        medianIsR0: r4(median(bs.map((b) => b.sig?.is.meanR0 ?? 0))),
        medianOosR0: r4(median(bs.map((b) => b.sig?.oos.meanR0 ?? 0))),
        holdPositive: bs.filter((b) => b.hold && b.hold.m.net > 0).length,
        holdBots: bs.filter((b) => b.hold).length,
      }
    })
  }
  // Before costs: every version on its pooled markets, no news filter, per signal.
  const zeroCost = fib
    .filter((b) => b.scope === 'all' && b.news === 'off' && b.sig)
    .map((b) => ({
      id: b.id,
      variant: b.variant,
      tf: b.tf,
      style: b.style,
      isN: b.sig!.is.n,
      oosN: b.sig!.oos.n,
      isR0: r4(b.sig!.is.meanR0),
      oosR0: r4(b.sig!.oos.meanR0),
      isR: r4(b.sig!.is.meanR),
      oosR: r4(b.sig!.oos.meanR),
      isSe: r4(b.sig!.is.se),
      oosSe: r4(b.sig!.oos.se),
    }))
  const chosenK: Record<string, number> = {}
  const chosenEntry: Record<string, number> = {}
  for (const b of fib) {
    chosenK[b.params.k] = (chosenK[b.params.k] ?? 0) + 1
    chosenEntry[b.params.entry] = (chosenEntry[b.params.entry] ?? 0) + 1
  }
  return {
    byVariant: by((b) => b.variant),
    byTfStyle: by((b) => `${b.tf}-${b.style}`),
    byMarket: by((b) => b.scope),
    zeroCost,
    chosenK,
    chosenEntry,
  }
}

async function main() {
  const t0 = Date.now()
  mkdirSync(OUT, { recursive: true })
  let specs = allBotSpecs()
  if (ONLY) specs = specs.filter((s) => s.id.includes(ONLY))
  // One job per strategy variant and candle size, so its candles and planned trades are shared.
  const groups = new Map<string, BotSpec[]>()
  for (const s of specs) {
    const k = `${s.family}|${s.variant}|${s.tf}`
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  // Small candles (most work) first.
  const jobs = [...groups.values()].sort((a, b) => TF_SEC[a[0].tf] - TF_SEC[b[0].tf])
  console.log(
    `strategy lab: ${specs.length} bots in ${jobs.length} jobs, ${WORKERS} workers, out ${OUT}`,
  )

  const pool = new Pool(WORKERS)
  let done = 0
  const results = (
    await Promise.all(
      jobs.map((g) =>
        pool.run<BotResult[]>({ kind: 'group', specs: g }).then((r) => {
          done++
          console.log(
            `  [${done}/${jobs.length}] ${g[0].family} ${g[0].variant} ${g[0].tf}: ${g.length} bots (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
          )
          return r
        }),
      ),
    )
  ).flat()

  const bySpec = new Map(specs.map((s) => [s.id, s]))
  const real = results.filter((b) => b.family !== 'control')

  // Copies: bots with exactly the same out-of-sample trades (most often the
  // "off" and "block" news versions) count once; the first in id order stays.
  const copiesOf = new Map<string, string[]>()
  const keyOf = (b: BotResult) => `${b.variant}|${b.tf}|${b.scope}|${b.extras?.sig ?? b.id}`
  const firstOf = new Map<string, BotResult>()
  for (const b of [...real].sort((a, c) => a.id.localeCompare(c.id))) {
    const k = keyOf(b)
    const f = firstOf.get(k)
    if (!f) {
      firstOf.set(k, b)
      copiesOf.set(b.id, [])
    } else copiesOf.get(f.id)!.push(b.id)
  }
  const distinct = [...firstOf.values()]
  const distinctEl = distinct.filter((b) => b.eligible)

  // Luck: the random-direction test per distinct bot, Holm over all of them.
  const ps = distinctEl.map((b) => b.sig?.oos.p ?? null)
  const survive = holm(ps)
  const nTests = ps.filter((p) => p != null).length
  const luck = {
    words:
      'For each bot, every out-of-sample signal was also traded the other way (same time, stop and target mirrored). With no skill in the direction, the real side would beat the flipped side about half the time; z says how far it did better, p how often luck alone gets that far. Holm corrects for testing many bots at once.',
    tests: nTests,
    bonferroniZ: r2(bonferroniZ(nTests)),
    p05: ps.filter((p) => p != null && p < 0.05).length,
    expectedByLuck: r2(nTests * 0.05),
    survivors: distinctEl.filter((_, i) => survive[i]).map((b) => b.id),
    best: distinctEl
      .filter((b) => b.sig?.oos.p != null)
      .sort((a, b) => a.sig!.oos.p! - b.sig!.oos.p!)
      .slice(0, 12)
      .map((b) => ({
        id: b.id,
        z: r2(b.sig!.oos.z),
        p: r4(b.sig!.oos.p),
        isZ: r2(b.sig!.is.z),
        isP: r4(b.sig!.is.p),
        oosT: r2(b.sig!.oos.t),
        isT: r2(b.sig!.is.t),
        n: b.sig!.oos.n,
      })),
    coins: (() => {
      const coins = results.filter((b) => b.family === 'control' && b.eligible)
      return {
        eligible: coins.length,
        positiveOos: coins.filter((b) => b.oos.net > 0).length,
        positiveBoth: coins.filter((b) => b.oos.net > 0 && b.is.net > 0).length,
        best: [...coins]
          .sort((a, b) => b.oos.perMonth - a.oos.perMonth)
          .slice(0, 3)
          .map((b) => ({
            id: b.id,
            oosNet: r2(b.oos.net),
            isNet: r2(b.is.net),
            oosT: r2(b.sig?.oos.t),
          })),
      }
    })(),
    realPositiveOos: distinctEl.filter((b) => b.oos.net > 0).length,
    realPositiveBoth: distinctEl.filter((b) => b.oos.net > 0 && b.is.net > 0).length,
  }

  // Ranking: the lower of the in-sample and out-of-sample per-signal t (both halves must be good).
  const ranked = distinctEl.sort((a, b) => bothT(b) - bothT(a))
  const top10: BotResult[] = []
  const seen = new Set<string>()
  for (const b of ranked) {
    const k = `${b.variant}|${b.tf}-${b.style}`
    if (seen.has(k)) continue
    seen.add(k)
    top10.push(b)
    if (top10.length === 10) break
  }
  const probablyLuck = ranked
    .filter((b) => b.oos.net > 0 && b.is.net <= 0)
    .sort((a, b) => b.oos.net - a.oos.net)
    .slice(0, 10)
  const pick = pickTop5(distinct)
  // The first run's shortlist and favourites, followed up.
  const firstRun = [
    'rsi-range-reversal|1h-race|US30|off',
    'rsi-range-reversal|1h-race|USDJPY|off',
    'lb|15m-day|XAUUSD|close',
    'lb|15m-day|GBPUSD|off',
    'fib|4h-swing|USDJPY|off',
  ].filter((id) => bySpec.has(id))
  const fibBest = [...distinct]
    .filter((b) => b.family === 'fib' && b.eligible)
    .sort((a, b) => bothT(b) - bothT(a))
    .slice(0, 3)
  const swingFib = [...distinct]
    .filter((b) => b.variant === 'fib-swing')
    .sort((a, b) => bothT(b) - bothT(a))
    .slice(0, 3)

  // Ensembles ("combining them all"): parts chosen on in-sample results only.
  const ens: { ensId: string; name: string; parts: EnsemblePart[] }[] = []
  if (!ONLY) {
    const gx: ('GBPUSD' | 'XAUUSD')[] = ['GBPUSD', 'XAUUSD']
    for (const news of ['off', 'block'] as const) {
      const part = (
        family: BotSpec['family'],
        variant: string,
        tf: BotSpec['tf'],
        style: BotSpec['style'],
      ): EnsemblePart => ({
        spec: {
          id: `${variant}|${tf}-${style}|GBPUSD+XAUUSD|${news}`,
          family,
          variant,
          tf,
          style,
          markets: gx,
          scope: 'GBPUSD+XAUUSD',
          news,
        },
      })
      ens.push({
        ensId: `ens-john-15m|${news}`,
        name: "John's mix: Fib + candle, scalper, London breakout (15m, one account)",
        parts: [
          part('fib', 'fib-candle', '15m', 'day'),
          part('scalper', 'scalper', '15m', 'scalp'),
          part('london', 'lb', '15m', 'day'),
        ],
      })
    }
    const bestIs = (pred: (b: BotResult) => boolean) =>
      real
        .filter((b) => pred(b) && b.is.trades >= MIN_OOS_TRADES)
        .sort((a, b) => b.is.perMonth - a.is.perMonth)[0]
    const fibParts = (['15m-day', '1h-day', '4h-swing'] as const)
      .map((ts) =>
        bestIs(
          (b) =>
            b.family === 'fib' &&
            `${b.tf}-${b.style}` === ts &&
            b.scope === 'all' &&
            b.news === 'block',
        ),
      )
      .filter((b): b is BotResult => !!b)
    if (fibParts.length)
      ens.push({
        ensId: 'ens-fib-multi|block',
        name: "John's Fib on 15m + 1h + 4h (best in-sample version each, one account)",
        parts: fibParts.map((b) => ({ spec: bySpec.get(b.id)!, params: b.params })),
      })
    const top5is: BotResult[] = []
    const fams = new Set<string>()
    for (const b of real
      .filter((x) => x.is.trades >= MIN_OOS_TRADES)
      .sort((a, b) => b.is.perMonth - a.is.perMonth)) {
      const f = `${b.variant}|${b.tf}`
      if (fams.has(f)) continue
      fams.add(f)
      top5is.push(b)
      if (top5is.length === 5) break
    }
    if (top5is.length)
      ens.push({
        ensId: 'ens-top5-is',
        name: 'Top 5 by in-sample money (different strategies, one account)',
        parts: top5is.map((b) => ({ spec: bySpec.get(b.id)!, params: b.params })),
      })
  }

  const detailIds = [
    ...new Set([
      ...pick.top.map((b) => b.id),
      ...top10.map((b) => b.id),
      ...firstRun,
      ...fibBest.map((b) => b.id),
      ...swingFib.map((b) => b.id),
    ]),
  ]
  console.log(`details: ${detailIds.length} bots, ${ens.length} combined accounts`)
  const detailOf = (id: string) =>
    pool.run<BotResult & { detail: BotDetail }>({ kind: 'detail', spec: bySpec.get(id)! })
  const [details, ensembles] = await Promise.all([
    Promise.all(detailIds.map(detailOf)),
    Promise.all(
      ens.map((e) => pool.run<BotResult & { detail: BotDetail }>({ kind: 'ensemble', ...e })),
    ),
  ])
  pool.close()
  const detailById = new Map(details.map((d) => [d.id, d]))

  const all = [...results, ...ensembles.map(({ detail: _d, ...r }) => (void _d, r))]
  const elig = distinct.filter((b) => b.eligible)
  const out = {
    generatedAt: new Date().toISOString(),
    runSeconds: Math.round((Date.now() - t0) / 1000),
    workers: WORKERS,
    historyDir: process.env.LAB_HISTORY ?? join(homedir(), 'jvd-outputs/trading/history'),
    settings: {
      startMoney: START_MONEY,
      sizing: RACE_SIZING,
      leverage: Object.fromEntries(LAB_MARKETS.map((m) => [m.id, m.leverage])),
      inSampleShare: IS_SHARE,
      minOosTrades: MIN_OOS_TRADES,
      minIsTradesToChoose: MIN_IS_TRADES,
      newsPadMinutes: NEWS_PAD_SEC / 60,
      costTimes: { rolloverX: ROLLOVER_X, reopenX: REOPEN_X, newsX: NEWS_X },
      costs: LAB_MARKETS.map((m) => ({
        id: m.id,
        label: m.label,
        spread: m.spread,
        slippage: m.slippage,
        unit: m.pct ? 'share of price' : 'price',
        feePerSide: m.fee,
        leverage: m.leverage,
        swap: m.swap,
        timeframes: m.tfs,
      })),
      styles: STYLE_WORDS,
      params: PARAM_WORDS,
      rankBy:
        'the lower of the in-sample and out-of-sample t of the average R per signal (each signal traded on its own), bots with at least 30 out-of-sample trades, copies merged',
    },
    counts: {
      bots: real.length,
      controls: results.length - real.length,
      distinct: distinct.length,
      eligible: elig.length,
      positiveOos: elig.filter((b) => b.oos.net > 0).length,
      positiveBoth: elig.filter((b) => b.oos.net > 0 && b.is.net > 0).length,
      holdBots: elig.filter((b) => b.hold).length,
      holdPositive: elig.filter((b) => b.hold && b.hold.m.net > 0).length,
      positiveAll3: elig.filter((b) => b.hold && b.hold.m.net > 0 && b.oos.net > 0 && b.is.net > 0)
        .length,
    },
    ranking: ranked.map((b) => b.id),
    copies: Object.fromEntries([...copiesOf.entries()].filter(([, v]) => v.length)),
    luck,
    top5: {
      rule: 'at least 30 out-of-sample trades, out-of-sample drawdown under 25%, in-sample profit factor at least 1 and out-of-sample at most 0.5 above it; ranked by out-of-sample profit factor; copies merged and news versions of one bot counted once; at most 2 per strategy family; the best qualifying Fib takes 5th place if none made it',
      qualified: pick.qualified,
      fibSwapped: pick.fibSwapped,
      bestFibQualified: pick.bestFib?.id ?? null,
      bots: pick.top.map((b) => detailById.get(b.id)!),
    },
    top10: top10.map((t) => detailById.get(t.id)!),
    probablyLuck: probablyLuck.map((b) => b.id),
    firstRun: firstRun.map((id) => detailById.get(id)!),
    fibBest: fibBest.map((b) => detailById.get(b.id)!),
    swingFib: swingFib.map((b) => detailById.get(b.id)!),
    ensembles,
    newsEffect: newsEffect(results),
    families: familySummary(results),
    fib: fibSummary(results),
    bots: all,
  }
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(out))

  const head =
    'rank,id,name,markets,news,params,copies,both_t,is_t,oos_t,is_avg_r,oos_avg_r,oos_dir_p,oos_trades,oos_win_rate,oos_profit_factor,oos_net,oos_without_top3,oos_max_dd_pct,oos_per_month,is_trades,is_profit_factor,is_net,hold_trades,hold_net,hold_avg_r'
  const line = (b: BotResult, i: number) =>
    [
      i + 1,
      b.id,
      `"${b.name}"`,
      b.markets.join('+'),
      b.news,
      `"${JSON.stringify(b.params).replace(/"/g, '')}"`,
      copiesOf.get(b.id)?.length ?? 0,
      r2(bothT(b)),
      r2(b.sig?.is.t),
      r2(b.sig?.oos.t),
      r4(b.sig?.is.meanR),
      r4(b.sig?.oos.meanR),
      r4(b.sig?.oos.p),
      b.oos.trades,
      r2(b.oos.winRate),
      r2(b.oos.profitFactor),
      r2(b.oos.net),
      r2(b.extras?.oosWithoutTop3),
      r2(b.oos.maxDrawdownPct),
      r2(b.oos.perMonth),
      b.is.trades,
      r2(b.is.profitFactor),
      r2(b.is.net),
      b.hold?.m.trades ?? '',
      r2(b.hold?.m.net) ?? '',
      r4(b.hold?.sig.meanR) ?? '',
    ].join(',')
  writeFileSync(join(OUT, 'ranking.csv'), [head, ...ranked.map(line)].join('\n') + '\n')
  const f = (x: number | null | undefined, d = 2) => (x == null ? '-' : x.toFixed(d))
  const md = [
    `# Strategy lab ranking (${out.generatedAt.slice(0, 16)}Z)`,
    '',
    `Ranked by the lower of the in-sample and out-of-sample t of the average R per signal (each signal on its own, all costs), so both halves have to be good. ${ranked.length} distinct bots with at least ${MIN_OOS_TRADES} out-of-sample trades (copies with the same trades merged). Holdout = 2019 to 2024-11 history no step chose anything on (1h and up only).`,
    '',
    '| # | Bot | t (both) | Avg R IS / OOS | OOS trades | PF | OOS net | w/o top 3 | Max DD | IS net | Holdout net |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...ranked
      .slice(0, 60)
      .map(
        (b, i) =>
          `| ${i + 1} | ${b.id} | ${f(bothT(b))} | ${f(b.sig?.is.meanR)} / ${f(b.sig?.oos.meanR)} | ${b.oos.trades} | ${f(b.oos.profitFactor)} | ${b.oos.net.toFixed(0)} | ${f(b.extras?.oosWithoutTop3, 0)} | ${b.oos.maxDrawdownPct.toFixed(1)}% | ${b.is.net.toFixed(0)} | ${b.hold ? b.hold.m.net.toFixed(0) : '-'} |`,
      ),
  ]
  writeFileSync(join(OUT, 'ranking.md'), md.join('\n') + '\n')

  console.log(
    `\nbots ${results.length} (${distinct.length} distinct real), ranked ${elig.length}, positive OOS ${out.counts.positiveOos}, both ${out.counts.positiveBoth}, holdout positive ${out.counts.holdPositive}/${out.counts.holdBots}`,
  )
  console.log(
    `luck: ${luck.tests} tests, p<0.05: ${luck.p05} (luck alone: ${luck.expectedByLuck}), Holm survivors ${luck.survivors.length}, Bonferroni z ${luck.bonferroniZ}`,
  )
  console.log(`top 5 (qualified ${pick.qualified}${pick.fibSwapped ? ', Fib swapped in' : ''}):`)
  for (const b of pick.top)
    console.log(
      `  ${b.id.padEnd(48)} oos ${b.oos.trades} tr, PF ${f(b.oos.profitFactor)}, $${b.oos.net.toFixed(0)}, dd ${b.oos.maxDrawdownPct.toFixed(1)}%, is PF ${f(b.is.profitFactor)} $${b.is.net.toFixed(0)}, hold ${b.hold ? `$${b.hold.m.net.toFixed(0)} (${b.hold.m.trades} tr, PF ${f(b.hold.m.profitFactor)})` : '-'}`,
    )
  console.log('top 10 by both-halves t:')
  for (const b of top10)
    console.log(
      `  ${b.id.padEnd(48)} t ${f(bothT(b))}, R ${f(b.sig?.is.meanR)}/${f(b.sig?.oos.meanR)}, oos $${b.oos.net.toFixed(0)}, hold ${b.hold ? `$${b.hold.m.net.toFixed(0)} R ${f(b.hold.sig.meanR)}` : '-'}`,
    )
  console.log(`done in ${out.runSeconds} s: ${join(OUT, 'results.json')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
