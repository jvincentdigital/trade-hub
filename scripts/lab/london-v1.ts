/**
 * John's London Strategy v1: the design runs (SPEC.md sections 4 and 5).
 *
 *   npx tsx scripts/lab/london-v1.ts --history DIR --from 2025-11-11 --to 2026-11-10 --out DIR
 *
 * Runs v1 for the 4 pre-registered (k, b) pairs, picks one with the rule in
 * section 4, then runs v1-flip on it with q = 0.5 and q = 1.0 and picks q.
 * Each run: one $10,000 account on GBP/USD and gold, the mirror test and
 * 1,000 coin flips. Writes results.json and results.md to --out.
 *
 * Design data only: the loader refuses the clean holdout folder, any file but
 * the 1-minute ones, and any candle before 2025-11-11 00:00 UTC. Play money
 * only: no network, nothing live is touched. See docs/strategy-lab.md.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { OHLCCandle } from '../../src/lib/types/market'
import {
  assertDesignCandles,
  assertDesignFile,
  coinRun,
  DESIGN_START,
  flipBeatsPlain,
  LONDON_MARKETS,
  mirrorTest,
  p95,
  passLines,
  pickPair,
  pickQ,
  prepareMarket,
  rescoreCosts,
  runLondon,
  summarize,
  V1,
  V1_GRID,
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

if (!Number.isFinite(FROM) || !Number.isFinite(TO) || TO <= FROM) throw new Error('bad --from/--to')
if (FROM < DESIGN_START) throw new Error('design runs start on 2025-11-11 or later')
if (/history-1m-24mo|history-old/.test(HISTORY))
  throw new Error('refusing the clean or old history')

async function loadDesign(id: LondonMarketId): Promise<OHLCCandle[]> {
  const file = historyFile(HISTORY, id, '1m' as never)
  assertDesignFile(file, id)
  if (!existsSync(file)) throw new Error(`missing ${file}`)
  const c = await loadCandleFile(file)
  assertDesignCandles(c, file)
  return c.filter((b) => b.time >= FROM && b.time < TO)
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const f = (x: number | null | undefined, d = 2) =>
  x == null || !Number.isFinite(x) ? 'n/a' : (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d)
const usd = (x: number) =>
  `${x < 0 ? '-' : ''}$${Math.abs(x)
    .toFixed(0)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

interface Scored {
  name: string
  run: RunResult
  summary: ReturnType<typeof summarize>
  perMarket: Record<string, ReturnType<typeof summarize>>
  perLeg: Record<string, ReturnType<typeof summarize>>
  buys: ReturnType<typeof summarize>
  sells: ReturnType<typeof summarize>
  summer: ReturnType<typeof summarize>
  winter: ReturnType<typeof summarize>
  mirror: { z: number | null; p: number | null; n: number; mirrorTotal: number }
  coin: { mean: number; p95: number; beats: number; missed: number }
  halfCostsR: number
  doubleCostsR: number
  pass: ReturnType<typeof passLines>
  reasons: Record<string, number>
  lateExits: number
  tradeListSha256: string
}

function score(name: string, run: RunResult, byId: Map<LondonMarketId, LondonData>): Scored {
  const ts = run.trades
  const s = summarize(ts)
  const mirror = mirrorTest(ts, byId)
  const coins: number[] = []
  let missed = 0
  for (let seed = 1; seed <= COIN_RUNS; seed++) {
    const c = coinRun(ts, byId, seed)
    coins.push(c.total)
    missed += c.missed
  }
  const coinP95 = p95(coins)
  const reasons: Record<string, number> = {}
  for (const o of run.outcomes)
    reasons[`${o.leg}: ${o.result}`] = (reasons[`${o.leg}: ${o.result}`] ?? 0) + 1
  const by = (pred: (t: LondonTrade) => boolean) => summarize(ts.filter(pred))
  return {
    name,
    run,
    summary: s,
    perMarket: Object.fromEntries(LONDON_MARKETS.map((m) => [m, by((t) => t.market === m)])),
    perLeg: Object.fromEntries(
      (['v1', 'reverse', 'reentry'] as const).map((l) => [l, by((t) => t.leg === l)]),
    ),
    buys: by((t) => t.long),
    sells: by((t) => !t.long),
    summer: by((t) => t.summer),
    winter: by((t) => !t.summer),
    mirror,
    coin: {
      mean: sum(coins) / coins.length,
      p95: coinP95,
      beats: coins.filter((x) => x < s.totalR).length / coins.length,
      missed,
    },
    halfCostsR: sum(ts.map((t) => rescoreCosts(t, byId.get(t.market)!, 0.5))),
    doubleCostsR: sum(ts.map((t) => rescoreCosts(t, byId.get(t.market)!, 2))),
    pass: passLines({
      trades: s.trades,
      endBalance: run.endBalance,
      start: V1.startMoney,
      avgR: s.avgR,
      profitFactor: s.profitFactor,
      maxDrawdown: run.maxDrawdown,
      totalR: s.totalR,
      coinP95,
      mirrorZ: mirror.z,
    }),
    reasons,
    // Exits more than an hour after their deadline (data stopped before it).
    lateExits: ts.filter((t) => t.exitTime - t.deadline > 3600).length,
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

const signalNoTrade = (run: RunResult) => {
  // 2025-11-17, SELL signal on the candle that starts 11:15 UTC: no trade (plan under 1.5R).
  const T = Date.parse('2025-11-17T11:30:00Z') / 1000
  return run.outcomes.find((o) => o.market === 'GBPUSD' && o.leg === 'v1' && o.T === T) ?? null
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const news = [...(await loadNews(HISTORY)), ...ismEvents(FROM - 30 * DAY, TO + DAY)]
  const data: LondonData[] = []
  for (const id of LONDON_MARKETS) {
    const m1 = await loadDesign(id)
    data.push(prepareMarket(id, m1, news))
    console.log(
      `${id}: ${m1.length} one-minute candles, ${isoMinute(m1[0].time)} to ${isoMinute(m1[m1.length - 1].time)}`,
    )
  }
  const byId = new Map(data.map((d) => [d.id, d]))
  const skipped = [
    {
      market: 'EURGBP',
      why: 'out of v1 (SPEC 2.2): its 1-minute design data only covers 2026-11-01 to 2026-11-10, so it was not loaded or run',
    },
  ]

  const plain: Scored[] = []
  for (const k of V1_GRID.k)
    for (const b of V1_GRID.b) {
      const run = runLondon(data, { k, b, flip: false }, FROM, TO)
      plain.push(score(`v1 k=${k} b=${b}`, run, byId))
      console.log(
        `v1 k=${k} b=${b}: ${run.trades.length} trades, ${f(summarize(run.trades).totalR, 1)}R, $${f(run.endBalance, 0)}, DD ${f(run.maxDrawdown * 100, 1)}%`,
      )
    }
  const pick = pickPair(
    plain.map((p) => ({
      k: p.run.options.k,
      b: p.run.options.b,
      trades: p.summary.trades,
      totalR: p.summary.totalR,
      maxDrawdown: p.run.maxDrawdown,
    })),
  )
  const picked = plain.find((p) => p.run.options.k === pick.k && p.run.options.b === pick.b)!
  const flips: Scored[] = []
  for (const q of V1_GRID.q) {
    const run = runLondon(data, { k: pick.k, b: pick.b, flip: true, q }, FROM, TO)
    flips.push(score(`v1-flip k=${pick.k} b=${pick.b} q=${q}`, run, byId))
    console.log(
      `v1-flip q=${q}: ${run.trades.length} trades, ${f(summarize(run.trades).totalR, 1)}R, $${f(run.endBalance, 0)}, DD ${f(run.maxDrawdown * 100, 1)}%`,
    )
  }
  const q = pickQ(flips.map((x) => ({ q: x.run.options.q!, totalR: x.summary.totalR })))
  const flipPicked = flips.find((x) => x.run.options.q === q)!
  const beats = (fl: Scored) => {
    const legs = fl.run.trades.filter((t) => t.leg !== 'v1')
    return flipBeatsPlain({
      reverseTrades: fl.perLeg.reverse.trades,
      flipLegsR: sum(legs.map((t) => t.r)),
      flipTotalR: fl.summary.totalR,
      plainTotalR: picked.summary.totalR,
      flipDrawdown: fl.run.maxDrawdown,
      plainDrawdown: picked.run.maxDrawdown,
    })
  }
  // v1 trades the flip gave up (in plain, not in flip).
  const givenUp = (fl: Scored) => {
    const keys = new Set(
      fl.run.trades.filter((t) => t.leg === 'v1').map((t) => `${t.market}|${t.entryTime}`),
    )
    const lost = picked.run.trades.filter((t) => !keys.has(`${t.market}|${t.entryTime}`))
    return { trades: lost.length, r: sum(lost.map((t) => t.r)) }
  }
  const examples = checkValues(
    plain.find((p) => p.run.options.k === 2 && p.run.options.b === 0.5)!.run,
  )
  const noTradeExample = signalNoTrade(
    plain.find((p) => p.run.options.k === 2 && p.run.options.b === 0.5)!.run,
  )

  const json = {
    strategy: "John's London Strategy v1",
    spec: '~/jvd-outputs/2026-11-11/london-strategy/SPEC.md',
    data: {
      history: HISTORY,
      from: isoMinute(FROM),
      toExclusive: isoMinute(TO),
      markets: LONDON_MARKETS,
      skipped,
    },
    rules: V1,
    selection: {
      pair: { k: pick.k, b: pick.b, qualified: pick.qualified, eligible: pick.eligible },
      q,
      selected: { k: pick.k, b: pick.b, q },
    },
    checkValues: examples,
    noTradeExample,
    runs: [...plain, ...flips].map((x) => ({
      name: x.name,
      options: x.run.options,
      signals: x.run.signals,
      endBalance: x.run.endBalance,
      maxDrawdown: x.run.maxDrawdown,
      maxOpenSeen: x.run.maxOpenSeen,
      maxOpenRiskSeen: x.run.maxOpenRiskSeen,
      summary: x.summary,
      perMarket: x.perMarket,
      perLeg: x.run.options.flip ? x.perLeg : undefined,
      buys: x.buys,
      sells: x.sells,
      summer: x.summer,
      winter: x.winter,
      mirror: x.mirror,
      coinFlips: { runs: COIN_RUNS, ...x.coin },
      halfCostsR: x.halfCostsR,
      doubleCostsR: x.doubleCostsR,
      passLinesOnDesignYear: x.pass,
      flipBeatsPlain: x.run.options.flip ? beats(x) : undefined,
      givenUpV1Trades: x.run.options.flip ? givenUp(x) : undefined,
      noTradeReasons: x.reasons,
      lateExits: x.lateExits,
      tradeListSha256: x.tradeListSha256,
      trades: x.run.trades,
    })),
  }
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(json, null, 1))

  // ── results.md, plain English ──
  const L: string[] = []
  const row = (name: string, x: Scored) => {
    const s = x.summary
    return `| ${name} | ${s.trades} | ${f(s.winRate * 100, 0)}% | ${usd(x.run.endBalance - V1.startMoney)} | ${f(s.profitFactor)} | ${f(x.run.maxDrawdown * 100, 1)}% | ${f(s.avgR)}R | ${f(s.totalR, 1)}R | ${f(s.avgWinPct)}% |`
  }
  const head =
    '| Run | Trades | Win rate | $ result | Profit factor | Max drop | Average | Total | Gain per winner |\n|---|---|---|---|---|---|---|---|---|'
  L.push("# John's London v1: design year results", '')
  L.push(
    `Design data only, ${arg('from')} to ${arg('to')} (UTC). GBP/USD and gold, one $10,000 play account per run, 2% risk a trade. Not the verdict: the clean year is scored later, once.`,
    '',
  )
  L.push(
    'EUR/GBP was not run. The spec takes it out of v1, and its 1-minute history only starts on 2026-11-01.',
    '',
  )
  L.push('## The pick', '')
  L.push(
    pick.qualified
      ? `Picked k = ${pick.k}, b = ${pick.b}, and for the flip q = ${q}. ${pick.eligible.length} of 4 pairs were eligible (100 or more trades, max drop 25% or less).`
      : `The design year did not qualify: no pair had 100 trades with a max drop of 25% or less. The defaults are used: k = ${pick.k}, b = ${pick.b}, q = ${q}.`,
    '',
  )
  L.push('## v1, the four settings', '', head)
  for (const x of plain) L.push(row(x.name, x))
  L.push('', '## Plain against flip (picked k and b)', '', head)
  L.push(row(`v1 k=${pick.k} b=${pick.b}`, picked))
  for (const x of flips) L.push(row(x.name, x))
  L.push('')
  for (const x of flips) {
    const bp = beats(x)
    const g = givenUp(x)
    L.push(
      `**${x.name}.** Reverse trades: ${x.perLeg.reverse.trades}, ${f(x.perLeg.reverse.totalR, 1)}R. Re-entries: ${x.perLeg.reentry.trades}, ${f(x.perLeg.reentry.totalR, 1)}R. It gave up ${g.trades} plain trades worth ${f(g.r, 1)}R. Flip beats plain: ${bp.beats ? 'yes' : 'no'} (${bp.checks.map((c) => `${c.text}: ${c.ok ? 'yes' : 'no'}`).join('; ')}).`,
      '',
    )
  }
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
    const part = (n: string, s: ReturnType<typeof summarize>) =>
      L.push(
        `| ${n} | ${s.trades} | ${f(s.winRate * 100, 0)}% | ${f(s.avgR)}R | ${f(s.totalR, 1)}R | ${f(s.profitFactor)} | ${usd(s.usd)} |`,
      )
    for (const m of LONDON_MARKETS) {
      const s = x.perMarket[m]
      part(m === 'GBPUSD' ? 'GBP/USD' : 'Gold', s)
    }
    if (x.run.options.flip) {
      part('First trades (v1)', x.perLeg.v1)
      part('Reverse trades', x.perLeg.reverse)
      part('Re-entries', x.perLeg.reentry)
    }
    part('Buys', x.buys)
    part('Sells', x.sells)
    part('UK summer', x.summer)
    part('UK winter', x.winter)
    L.push('')
    const drag = LONDON_MARKETS.filter((m) => x.perMarket[m].trades >= 30 && x.perMarket[m].usd < 0)
    L.push(
      `- Mirror (every trade the other way): ${f(x.mirror.mirrorTotal, 1)}R, z = ${f(x.mirror.z)}.`,
    )
    L.push(
      `- Coin flips (1,000 runs): average ${f(x.coin.mean, 1)}R, 95th percentile ${f(x.coin.p95, 1)}R. The real total beat ${f(x.coin.beats * 100, 0)}% of them.`,
    )
    L.push(`- At half costs ${f(x.halfCostsR, 1)}R, at double costs ${f(x.doubleCostsR, 1)}R.`)
    L.push(
      `- Without the 3 best trades: ${f(x.summary.withoutBest3R, 1)}R. Longest losing run: ${x.summary.longestLosingRun} trades. Ended on the clock or before news: ${f(x.summary.timeOrNewsShare * 100, 0)}%.`,
    )
    L.push(
      `- Average loser: ${f(x.summary.avgLossPct)}% of the balance. Average winner: +${f(x.summary.avgWinPct)}%.`,
    )
    if (drag.length) L.push(`- Drag (30 or more trades and a net loss): ${drag.join(', ')}.`)
    L.push(
      `- The six pass lines, on this design year (for information only): ${x.pass.lines.map((l) => `${l.line} ${l.ok ? 'yes' : 'no'}`).join(', ')}. Reads as: ${x.pass.verdict}.`,
      '',
    )
  }
  L.push('## Each run', '')
  for (const x of [...plain, ...flips]) detail(x)
  L.push('## Check values (spec 2.9, GBP/USD, k = 2, b = 0.5)', '')
  for (const e of examples)
    L.push(
      `- ${e.want.day} ${e.want.side}: ${e.ok ? 'matches' : 'DIFFERS'}. Spec: fill ${e.want.E}, stop ${e.want.stop}, plan ${e.want.rr}R, ${e.want.why}, ${e.want.r}R. Code: ${e.got ? `fill ${e.got.E}, stop ${e.got.stop}, plan ${e.got.rr}R, ${e.got.why} at ${e.got.exit}, ${e.got.r}R` : 'no trade'}.`,
    )
  L.push(
    `- 2025-11-17 SELL signal at 11:15: ${noTradeExample ? noTradeExample.result : 'no signal found'} (spec: no trade, plan under 1.5R).`,
    '',
  )
  const tradeTable = (x: Scored) => {
    L.push(`### Trades: ${x.name}`, '')
    L.push(
      '| # | Market | Leg | Side | Entry (UTC) | Fill | Stop | Plan | Exit (UTC) | How | R | $ |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|',
    )
    for (const t of x.run.trades)
      L.push(
        `| ${t.id + 1} | ${t.market === 'GBPUSD' ? 'GBP/USD' : 'Gold'} | ${t.leg} | ${t.side} | ${isoMinute(t.entryTime).replace('T', ' ').slice(0, 16)} | ${f(t.E, t.market === 'GBPUSD' ? 5 : 2)} | ${f(t.stop, t.market === 'GBPUSD' ? 5 : 2)} | ${f(t.planRR)}R | ${isoMinute(t.exitTime).replace('T', ' ').slice(0, 16)} | ${t.why}${t.tp1Hit && t.why !== 'tp2' ? ' (half at 0)' : ''} | ${f(t.r)} | ${usd(t.usd)} |`,
      )
    L.push('')
  }
  L.push('## Trade lists (picked settings)', '')
  tradeTable(picked)
  tradeTable(flipPicked)
  L.push('Every trade of every run is in results.json.', '')
  writeFileSync(join(OUT, 'results.md'), L.join('\n'))
  console.log(`picked k=${pick.k} b=${pick.b} q=${q} (qualified: ${pick.qualified})`)
  for (const e of examples)
    console.log(
      `check ${e.want.day} ${e.want.side}: ${e.ok ? 'ok' : 'DIFFERS'} ${JSON.stringify(e.got)}`,
    )
  console.log(`no-trade example: ${JSON.stringify(noTradeExample)}`)
  console.log(`wrote ${join(OUT, 'results.json')} and results.md`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
