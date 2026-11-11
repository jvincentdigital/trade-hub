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
import { LAB_MARKETS, TF_SEC } from '../../src/lib/lab/markets'
import { NEWS_PAD_SEC, NEWS_WORDS } from '../../src/lib/lab/news'
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
const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100)
const familyKey = (b: Pick<BotResult, 'variant' | 'tf' | 'style' | 'scope'>) =>
  `${b.variant}|${b.tf}-${b.style}|${b.scope}`

function newsEffect(bots: BotResult[]) {
  const groups = new Map<string, Partial<Record<string, BotResult>>>()
  for (const b of bots) {
    const g = groups.get(familyKey(b)) ?? {}
    g[b.news] = b
    groups.set(familyKey(b), g)
  }
  const out: Record<string, unknown> = {}
  for (const mode of ['block', 'close', 'day']) {
    const diffs: {
      family: string
      diff: number
      off: number
      on: number
      tradesOff: number
      tradesOn: number
    }[] = []
    for (const [k, g] of groups) {
      const off = g.off
      const on = g[mode]
      if (!off || !on) continue
      diffs.push({
        family: k,
        diff: on.oos.net - off.oos.net,
        off: off.oos.net,
        on: on.oos.net,
        tradesOff: off.oos.trades,
        tradesOn: on.oos.trades,
      })
    }
    if (!diffs.length) continue
    const byFam: Record<string, { pairs: number; better: number; medianDiff: number | null }> = {}
    for (const d of diffs) {
      const fam = d.family.split('|')[0].replace(/^(fib).*/, '$1')
      const row = (byFam[fam] ??= { pairs: 0, better: 0, medianDiff: null })
      row.pairs++
      if (d.diff > 0) row.better++
    }
    for (const fam of Object.keys(byFam))
      byFam[fam].medianDiff = r2(
        median(
          diffs
            .filter((d) => d.family.split('|')[0].replace(/^(fib).*/, '$1') === fam)
            .map((d) => d.diff),
        ),
      )
    out[mode] = {
      words: NEWS_WORDS[mode as 'block'],
      pairs: diffs.length,
      better: diffs.filter((d) => d.diff > 0).length,
      worse: diffs.filter((d) => d.diff < 0).length,
      same: diffs.filter((d) => d.diff === 0).length,
      medianDiff: r2(median(diffs.map((d) => d.diff))),
      meanDiff: r2(diffs.reduce((a, d) => a + d.diff, 0) / diffs.length),
      medianTradesCut: r2(median(diffs.map((d) => d.tradesOff - d.tradesOn))),
      byFamily: byFam,
      biggest: [...diffs]
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
    const best = [...el].sort((a, b) => b.oos.perMonth - a.oos.perMonth)[0]
    return {
      variant,
      name: botName({ family: bs[0].family, variant, tf: bs[0].tf }),
      family: bs[0].family,
      bots: bs.length,
      eligible: el.length,
      positiveOos: el.filter((b) => b.oos.net > 0).length,
      positiveBoth: el.filter((b) => b.oos.net > 0 && b.is.net > 0).length,
      medianOosPerMonth: r2(median(el.map((b) => b.oos.perMonth))),
      medianIsPerMonth: r2(median(el.map((b) => b.is.perMonth))),
      best: best
        ? { id: best.id, oosPerMonth: r2(best.oos.perMonth), oosNet: r2(best.oos.net) }
        : null,
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
        medianOosPerMonth: r2(median(el.map((b) => b.oos.perMonth))),
        medianOosWinRate: r2(median(el.map((b) => b.oos.winRate ?? 0))),
        medianOosAvgR: r2(median(el.map((b) => b.oos.avgR ?? 0))),
        medianIsPerMonth: r2(median(el.map((b) => b.is.perMonth))),
        oosTrades: el.reduce((a, b) => a + b.oos.trades, 0),
      }
    })
  }
  const allNoNews = fib
    .filter((b) => b.scope === 'all' && b.news === 'off')
    .sort((a, b) => b.oos.perMonth - a.oos.perMonth)
    .map((b) => ({
      id: b.id,
      name: b.name,
      tf: b.tf,
      style: b.style,
      params: b.params,
      is: b.is,
      oos: b.oos,
      eligible: b.eligible,
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
    allMarketsNoNews: allNoNews,
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
  const ranked = real.filter((b) => b.eligible).sort((a, b) => b.oos.perMonth - a.oos.perMonth)
  // Top 10 distinct strategies: the best bot of each strategy variant and candle size.
  const seen = new Set<string>()
  const top10: BotResult[] = []
  for (const b of ranked) {
    const k = `${b.variant}|${b.tf}-${b.style}`
    if (seen.has(k)) continue
    seen.add(k)
    top10.push(b)
    if (top10.length === 10) break
  }
  const bestFib =
    ranked.find((b) => b.family === 'fib') ??
    real.filter((b) => b.family === 'fib').sort((a, b) => b.oos.perMonth - a.oos.perMonth)[0]
  // The luck line: what the best coin flip made out-of-sample.
  const coins = results
    .filter((b) => b.family === 'control' && b.eligible)
    .sort((a, b) => b.oos.perMonth - a.oos.perMonth)
  const luckLine = coins[0]?.oos.perMonth ?? 0
  const shortlist = ranked.filter((b) => b.is.net > 0 && b.oos.net > 0 && b.oos.perMonth > luckLine)

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
    const top5: BotResult[] = []
    const fams = new Set<string>()
    for (const b of real
      .filter((x) => x.is.trades >= MIN_OOS_TRADES)
      .sort((a, b) => b.is.perMonth - a.is.perMonth)) {
      const f = `${b.variant}|${b.tf}`
      if (fams.has(f)) continue
      fams.add(f)
      top5.push(b)
      if (top5.length === 5) break
    }
    if (top5.length)
      ens.push({
        ensId: 'ens-top5-is',
        name: 'Top 5 by in-sample money (different strategies, one account)',
        parts: top5.map((b) => ({ spec: bySpec.get(b.id)!, params: b.params })),
      })
  }

  console.log(`details: top 10, shortlist, best Fib, ${ens.length} combined accounts`)
  const detailSpecs = [...new Set([...top10, ...shortlist, ...(bestFib ? [bestFib] : [])])]
  // Cost check for John's Fib: every version on all markets, no news filter.
  const fibCostBots = real.filter(
    (b) => b.family === 'fib' && b.scope === 'all' && b.news === 'off' && b.oos.trades > 0,
  )
  const detailOf = (b: BotResult) =>
    pool.run<BotResult & { detail: BotDetail }>({ kind: 'detail', spec: bySpec.get(b.id)! })
  const [details, ensembles, fibCostDetails] = await Promise.all([
    Promise.all(detailSpecs.map(detailOf)),
    Promise.all(
      ens.map((e) => pool.run<BotResult & { detail: BotDetail }>({ kind: 'ensemble', ...e })),
    ),
    Promise.all(fibCostBots.map(detailOf)),
  ])
  pool.close()

  const all = [...results, ...ensembles.map(({ detail: _d, ...r }) => (void _d, r))]
  const rankedAll = all.filter((b) => b.eligible).sort((a, b) => b.oos.perMonth - a.oos.perMonth)
  const elig = real.filter((b) => b.eligible)
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
      costs: LAB_MARKETS.map((m) => ({
        id: m.id,
        label: m.label,
        spread: m.spread,
        slippage: m.slippage,
        unit: m.pct ? 'share of price' : 'price',
        feePerSide: m.fee,
        leverage: m.leverage,
        timeframes: m.tfs,
      })),
      styles: STYLE_WORDS,
      params: PARAM_WORDS,
      rankBy: 'out-of-sample $ per month, bots with at least 30 out-of-sample trades',
    },
    counts: {
      bots: real.length,
      controls: results.length - real.length,
      eligible: elig.length,
      positiveOos: elig.filter((b) => b.oos.net > 0).length,
      positiveBoth: elig.filter((b) => b.oos.net > 0 && b.is.net > 0).length,
      medianOosPerMonth: r2(median(elig.map((b) => b.oos.perMonth))),
      medianIsPerMonth: r2(median(elig.map((b) => b.is.perMonth))),
    },
    ranking: rankedAll.map((b) => b.id),
    luck: {
      words:
        'Coin flip bots: random entries, same exits and costs; the walk-forward keeps the luckiest of 6 seeds in-sample, as it does for real settings',
      line: r2(luckLine),
      best: coins.slice(0, 5).map((b) => ({
        id: b.id,
        oosPerMonth: r2(b.oos.perMonth),
        oosNet: r2(b.oos.net),
        oosTrades: b.oos.trades,
        isNet: r2(b.is.net),
      })),
      eligible: coins.length,
      positiveOos: coins.filter((b) => b.oos.net > 0).length,
      medianOosPerMonth: r2(median(coins.map((b) => b.oos.perMonth))),
      realAboveLine: ranked.filter((b) => b.oos.perMonth > luckLine).length,
      rankOfBestCoin: rankedAll.findIndex((b) => b.id === coins[0]?.id) + 1,
    },
    shortlist: shortlist.map((b) => b.id),
    top10: top10.map((t) => details.find((d) => d.id === t.id)!),
    shortlistDetails: details.filter((d) => shortlist.some((t) => t.id === d.id)),
    bestFib: details.find((d) => d.id === bestFib?.id) ?? null,
    ensembles,
    newsEffect: newsEffect(results),
    fibCosts: fibCostDetails.map((d) => ({
      id: d.id,
      variant: d.variant,
      tf: d.tf,
      style: d.style,
      trades: d.oos.trades,
      normal: r2(d.detail.costs.normal),
      free: r2(d.detail.costs.free),
      double: r2(d.detail.costs.double),
    })),
    families: familySummary(results),
    fib: fibSummary(results),
    bots: all,
  }
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(out))

  const head =
    'rank,id,name,markets,news,params,oos_trades,oos_win_rate,oos_profit_factor,oos_net,oos_end,oos_max_dd_pct,oos_per_month,oos_trades_per_month,oos_avg_r,oos_worst_month,is_trades,is_net,is_per_month'
  const line = (b: BotResult, i: number) =>
    [
      i + 1,
      b.id,
      `"${b.name}"`,
      b.markets.join('+'),
      b.news,
      `"${JSON.stringify(b.params).replace(/"/g, '')}"`,
      b.oos.trades,
      r2(b.oos.winRate),
      r2(b.oos.profitFactor),
      r2(b.oos.net),
      r2(b.oos.end),
      r2(b.oos.maxDrawdownPct),
      r2(b.oos.perMonth),
      r2(b.oos.tradesPerMonth),
      r2(b.oos.avgR),
      r2(b.oos.worstMonth),
      b.is.trades,
      r2(b.is.net),
      r2(b.is.perMonth),
    ].join(',')
  writeFileSync(join(OUT, 'ranking.csv'), [head, ...rankedAll.map(line)].join('\n') + '\n')
  const md = [
    `# Strategy lab ranking (${out.generatedAt.slice(0, 16)}Z)`,
    '',
    `Out-of-sample $ per month from $10,000, bots with at least ${MIN_OOS_TRADES} out-of-sample trades (${rankedAll.length} of ${all.length}). In-sample net shown for comparison.`,
    '',
    '| # | Bot | OOS trades | Win | PF | OOS net | $/month | Max DD | IS net |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rankedAll
      .slice(0, 60)
      .map(
        (b, i) =>
          `| ${i + 1} | ${b.id} | ${b.oos.trades} | ${((b.oos.winRate ?? 0) * 100).toFixed(0)}% | ${b.oos.profitFactor?.toFixed(2) ?? '-'} | ${b.oos.net.toFixed(0)} | ${b.oos.perMonth.toFixed(0)} | ${b.oos.maxDrawdownPct.toFixed(1)}% | ${b.is.net.toFixed(0)} |`,
      ),
  ]
  writeFileSync(join(OUT, 'ranking.md'), md.join('\n') + '\n')

  console.log(
    `\nbots ${results.length}, ranked ${elig.length}, positive out-of-sample ${out.counts.positiveOos}, positive in both ${out.counts.positiveBoth}`,
  )
  console.log('top 10 (distinct):')
  for (const b of top10)
    console.log(
      `  ${b.id.padEnd(48)} oos ${b.oos.trades} trades, $${b.oos.net.toFixed(0)} (${b.oos.perMonth.toFixed(0)}/mo), dd ${b.oos.maxDrawdownPct.toFixed(1)}%, is $${b.is.net.toFixed(0)}`,
    )
  for (const e of ensembles)
    console.log(
      `  ${e.id.padEnd(48)} oos ${e.oos.trades} trades, $${e.oos.net.toFixed(0)} (${e.oos.perMonth.toFixed(0)}/mo), is $${e.is.net.toFixed(0)}`,
    )
  console.log(`done in ${out.runSeconds} s: ${join(OUT, 'results.json')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
