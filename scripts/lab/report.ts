/**
 * Strategy lab report: REPORT.md and REPORT.html from results.json.
 *
 *   npx tsx scripts/lab/report.ts [--dir DIR]     (make lab runs it after the lab)
 *
 * DIR defaults to ~/jvd-outputs/<today>/strategy-lab. Hand-written files in
 * DIR go in as they are (plain paragraphs, "- " bullets, **bold**): notes.md
 * as "What it means", fixes.md as the review findings and what was done. A
 * run1-results.json there (an earlier run) adds a before-and-after table.
 * The HTML is one calm phone-first page: dark, one accent, no sideways scroll.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BotDetail, BotResult, Neighbour, SigStats } from '../../src/lib/lab/bots'
import { labMarket, type LabMarketId } from '../../src/lib/lab/markets'
import { LAB_BOTS, LAB_MAX_DAYS } from '../../src/lib/race/labBots'

type Detailed = BotResult & { detail: BotDetail }
interface FamRow {
  variant: string
  name: string
  family: string
  bots: number
  eligible: number
  positiveOos: number
  positiveBoth: number
  medianOosR: number | null
  medianIsR: number | null
  medianOosPerMonth: number | null
}
interface FibGroup {
  key: string
  bots: number
  eligible: number
  positiveOos: number
  positiveBoth: number
  medianOosPerMonth: number | null
  medianOosWinRate: number | null
  medianIsR: number | null
  medianOosR: number | null
  medianIsR0: number | null
  medianOosR0: number | null
  holdPositive: number
  holdBots: number
}
interface NewsRow {
  words: string
  pairs: number
  identical: number
  better: number
  worse: number
  signTestP: number | null
  medianDiff: number | null
}
interface Results {
  generatedAt: string
  runSeconds: number
  settings: {
    startMoney: number
    sizing: { riskPct: number; maxOpen: number; maxOpenRiskPct: number }
    inSampleShare: number
    minOosTrades: number
    newsPadMinutes: number
    costTimes: { rolloverX: number; reopenX: number; newsX: number }
    costs: {
      id: string
      label: string
      spread: number
      slippage: number
      unit: string
      feePerSide: number
      leverage: number
      swap: [number, number]
    }[]
    params: Record<string, string>
  }
  counts: {
    bots: number
    controls: number
    distinct: number
    eligible: number
    positiveOos: number
    positiveBoth: number
    holdBots: number
    holdPositive: number
    positiveAll3: number
  }
  luck: {
    tests: number
    bonferroniZ: number
    p05: number
    expectedByLuck: number
    survivors: string[]
    best: { id: string; z: number; p: number; isZ: number; isP: number; n: number }[]
    coins: {
      eligible: number
      positiveOos: number
      positiveBoth: number
      best: { id: string; oosNet: number; isNet: number }[]
    }
    realPositiveOos: number
    realPositiveBoth: number
  }
  ranking: string[]
  copies: Record<string, string[]>
  top5: {
    rule: string
    qualified: number
    fibSwapped: boolean
    bestFibQualified: string | null
    bots: Detailed[]
  }
  top10: Detailed[]
  probablyLuck: string[]
  firstRun: Detailed[]
  fibBest: Detailed[]
  swingFib: Detailed[]
  ensembles: Detailed[]
  newsEffect: Record<string, NewsRow>
  families: FamRow[]
  fib: {
    byVariant: FibGroup[]
    byTfStyle: FibGroup[]
    zeroCost: {
      id: string
      variant: string
      tf: string
      style: string
      isN: number
      oosN: number
      isR0: number | null
      oosR0: number | null
      isR: number | null
      oosR: number | null
      isSe: number | null
      oosSe: number | null
    }[]
  }
  bots: BotResult[]
}
interface Run1 {
  generatedAt: string
  counts: { bots: number; eligible: number; positiveOos: number; positiveBoth: number }
  bots: { id: string; is: { net: number }; oos: { net: number; trades: number } }[]
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const localDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const DIR = arg('dir') ?? join(homedir(), 'jvd-outputs', localDate(), 'strategy-lab')
const read = (f: string) => (existsSync(join(DIR, f)) ? readFileSync(join(DIR, f), 'utf8') : '')

const R: Results = JSON.parse(read('results.json'))
const RUN1: Run1 | null = read('run1-results.json') ? JSON.parse(read('run1-results.json')) : null
const NOTES = read('notes.md')
const FIXES = read('fixes.md')

// ── formatting ───────────────────────────────────────────
let MINUS = '-'
const usd = (x: number) => '$' + Math.round(Math.abs(x)).toLocaleString('en-US')
const money = (x: number) => (x < 0 ? MINUS : '') + usd(x)
const delta = (x: number) => (x < 0 ? MINUS : '+') + usd(x)
const pct = (x: number | null, d = 0) => (x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`)
const num = (x: number | null | undefined, d = 2) =>
  x == null ? 'n/a' : (x < 0 ? MINUS : '') + Math.abs(x).toFixed(d)
const sR = (x: number | null | undefined) =>
  x == null ? 'n/a' : (x < 0 ? MINUS : '+') + Math.abs(x).toFixed(2) + 'R'
const pv = (p: number | null | undefined) =>
  p == null ? 'n/a' : p < 0.001 ? 'under 0.001' : p.toFixed(3)

const TF: Record<string, string> = {
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': 'daily',
}
const STYLE: Record<string, string> = {
  scalp: 'scalp',
  day: 'day trade',
  swing: 'swing',
  position: 'position',
  race: 'race exits',
}
const NEWS: Record<string, string> = {
  off: 'no news filter',
  block: 'news: no new trades',
  close: 'news: close before',
  day: 'news: skip red days',
}
const mlabel = (id: string) => {
  try {
    return labMarket(id as LabMarketId).label
  } catch {
    return id
  }
}
const marketsShort = (b: BotResult) =>
  b.scope === 'all' ? `${b.markets.length} markets (no Bitcoin)` : b.markets.map(mlabel).join(' + ')
const label = (b: BotResult) =>
  b.family === 'ensemble'
    ? b.name
    : `${b.name}, ${TF[b.tf]} ${STYLE[b.style]}, ${marketsShort(b)}, ${NEWS[b.news]}`
const short = (b: BotResult) => `${b.name} (${TF[b.tf]}, ${marketsShort(b)})`
const byId = new Map(R.bots.map((b) => [b.id, b]))
const fmtDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)
const run1 = (id: string) => RUN1?.bots.find((b) => b.id === id) ?? null
const holdLine = (b: BotResult) =>
  !b.hold
    ? b.tf === '1h' || b.tf === '4h' || b.tf === '1d'
      ? 'Older history (2019-2024): not downloaded yet for this market.'
      : 'Older history (2019-2024): none for 5-30 minute candles.'
    : `Older history ${fmtDate(b.hold.span.from)} to ${fmtDate(b.hold.span.to)}, same settings, never used to pick anything: ${money(START + b.hold.m.net)} from $10,000 (${delta(b.hold.m.net)}, ${b.hold.m.trades} trades, profit factor ${num(b.hold.m.profitFactor)}, max drop ${b.hold.m.maxDrawdownPct.toFixed(1)}%), ${sR(b.hold.sig.meanR)} a signal.`
const START = 10_000
const sigLine = (name: string, s: SigStats) =>
  `${name}: ${s.n} signals, ${sR(s.meanR)} each after costs (${sR(s.meanR0)} with no costs, ${sR(s.meanR2)} with double); longs ${sR(s.long.meanR)} (${s.long.n}), shorts ${sR(s.short.meanR)} (${s.short.n}); luck test p ${pv(s.p)}`
const nbLine = (n: Neighbour[]) =>
  n.map((x) => `${x.label}: ${sR(x.isR)} / ${sR(x.oosR)}`).join('; ')
/** US30 with Micro Dow futures: whole contracts of $0.50 a point (units in the lab are $1 a point). */
const mymNet = (d: Detailed) =>
  d.detail.oosTrades
    .filter((t) => t.market === 'US30')
    .reduce(
      (a, t) => a + (t.units > 0 ? (t.pnl * Math.floor(t.units / 0.5) * 0.5) / t.units : 0),
      0,
    ) + d.detail.oosTrades.filter((t) => t.market !== 'US30').reduce((a, t) => a + t.pnl, 0)

// ── content model: blocks rendered to both formats ───────
type Block =
  | { h: 1 | 2 | 3; text: string }
  | { p: string }
  | { ul: string[] }
  | { table: { head: string[]; rows: string[][]; narrow?: boolean } }
  | { cards: { title: string; lines: string[] }[] }
  | { notes: string }

function botCard(d: Detailed, i: number | null): { title: string; lines: string[] } {
  const live = LAB_BOTS.find((b) => b.labId === d.id)
  const x = d.extras!
  const n = d.detail
  const ci = x.oosCi95 ? `${sR(x.oosCi95[0])} to ${sR(x.oosCi95[1])}` : 'n/a'
  const lines = [
    d.what,
    `Test months (${fmtDate(d.span.split)} to ${fmtDate(d.span.to)}): $10,000 became **${money(d.oos.end)}** (${delta(d.oos.net)}), ${d.oos.trades} trades, ${pct(d.oos.winRate)} won, profit factor ${num(d.oos.profitFactor)}, max drop ${d.oos.maxDrawdownPct.toFixed(1)}% (closed trades only). Settings ${JSON.stringify(d.params).replace(/"/g, '')}.`,
    `Earlier months (${fmtDate(d.span.from)} to ${fmtDate(d.span.split)}, where the settings were chosen): ${delta(d.is.net)} on ${d.is.trades} trades, profit factor ${num(d.is.profitFactor)}.`,
    `How fragile: without its 3 best test trades ${delta(x.oosWithoutTop3)}; 95% range of the average trade ${ci}; ${x.oosWeekend.trades} trades held over a weekend made ${delta(x.oosWeekend.net)}. With the first run's flat costs it would show ${delta(n.flatCostNet)}.`,
    sigLine('Each signal on its own, test months', d.sig!.oos),
    sigLine('Earlier months', d.sig!.is),
    `Nearby settings (average R per signal, earlier / test): ${nbLine(n.neighbours)}.`,
    `UK summer / winter time, test months: ${delta(x.season.oos.summer.net)} (${x.season.oos.summer.trades}) / ${delta(x.season.oos.winter.net)} (${x.season.oos.winter.trades}); earlier months: ${delta(x.season.is.summer.net)} (${x.season.is.summer.trades}) / ${delta(x.season.is.winter.net)} (${x.season.is.winter.trades}).`,
    holdLine(d),
  ]
  if (d.markets.includes('US30'))
    lines.push(
      `US30 sizing: in the US, a $10,000 account would trade Micro Dow futures ($0.50 a point, whole contracts), not a 20:1 CFD. Rounded down to whole contracts, the test months come to about ${delta(mymNet(d))} (risk per trade about 1% instead of 2%).`,
    )
  if (live) lines.push(`Live race: **${live.name}**, ${LAB_MAX_DAYS[live.style]}. ${live.why}`)
  return { title: `${i != null ? `${i}. ` : ''}${label(d)}`, lines }
}

function build(): Block[] {
  const s = R.settings
  const c = R.counts
  const L = R.luck
  const out: Block[] = []
  const t5 = R.top5.bots

  out.push({ h: 1, text: "Strategy lab, second run: after the reviewers' fixes" })
  out.push({
    p: `${c.bots} play-money bots (${c.distinct} different ones once exact copies are merged), each with its own $10,000 account and the race's rules: 2% risk per trade, at most 5 open, 10% open risk, margin limits. Run ${R.generatedAt.slice(0, 16).replace('T', ' ')} UTC on the Mac Mini in ${R.runSeconds} seconds. Nothing here touched a broker, a live account or the live race.`,
  })
  if (NOTES) out.push({ h: 2, text: 'What it means' }, { notes: NOTES })

  if (RUN1) {
    out.push({ h: 2, text: 'Before and after the fixes' })
    out.push({
      p: 'The first run (02:54 this morning) next to this one. Costs now include wider spreads at the rollover, the Sunday reopen and on news, plus overnight swap; sessions follow London and New York time; 4-hour and daily candles close at 17:00 New York; Bitcoin trades only in its own account. **Most results got worse.**',
    })
    const row = (name: string, id: string) => {
      const a = run1(id)
      const b = byId.get(id)
      return [
        name,
        a ? `${delta(a.oos.net)} (${delta(a.is.net)})` : 'n/a',
        b ? `${delta(b.oos.net)} (${delta(b.is.net)})` : 'n/a',
      ]
    }
    out.push({
      table: {
        head: ['', 'First run: test (earlier)', 'Now: test (earlier)'],
        rows: [
          [
            'Bots with 30+ test trades',
            String(RUN1.counts.eligible),
            `${c.eligible} (copies merged)`,
          ],
          ['Made money in the test months', String(RUN1.counts.positiveOos), String(c.positiveOos)],
          ['Made money in both halves', String(RUN1.counts.positiveBoth), String(c.positiveBoth)],
          row('RSI range reversal, 1h, US30', 'rsi-range-reversal|1h-race|US30|off'),
          row('RSI range reversal, 1h, USD/JPY', 'rsi-range-reversal|1h-race|USDJPY|off'),
          row('London breakout, gold, close before news', 'lb|15m-day|XAUUSD|close'),
          row("John's Fib, 4h, USD/JPY", 'fib|4h-swing|USDJPY|off'),
        ],
      },
    })
  }

  out.push({ h: 2, text: 'Top 5 for the live race' })
  out.push({
    p: `The rule, fixed before looking: ${R.top5.rule}. ${R.top5.qualified} bots qualified. The older 2019-2024 history played no part in the choice. ${R.top5.fibSwapped ? 'No Fib was in the top 5, so the best qualifying Fib took 5th place.' : t5.some((b) => b.family === 'fib') ? "John's Fib qualified on its own." : "No version of John's Fib qualified."}`,
  })
  out.push({
    table: {
      head: ['#', 'Bot', 'Test $', 'PF', 'Drop', 'Trades'],
      narrow: true,
      rows: t5.map((b, i) => [
        String(i + 1),
        `${b.name}, ${mlabel(b.markets[0])}, ${TF[b.tf]} ${STYLE[b.style]}`,
        delta(b.oos.net),
        num(b.oos.profitFactor),
        `${b.oos.maxDrawdownPct.toFixed(0)}%`,
        String(b.oos.trades),
      ]),
    },
  })
  out.push({ cards: t5.map((d, i) => botCard(d, i + 1)) })

  out.push({ h: 2, text: 'Is any of it more than luck?' })
  out.push({
    ul: [
      `**The random-direction test.** ${L.tests} different bots with 30+ test trades. For each, every test-months signal was also traded the other way (same time, stop and target mirrored). ${L.p05} of them beat their mirror at the usual 5% level; luck alone would give about ${num(L.expectedByLuck, 0)}. As a group the bots pick the side no better than a coin.`,
      `After correcting for testing ${L.tests} bots (Holm), ${L.survivors.length} pass: ${L.survivors.map((id) => short(byId.get(id)!)).join('; ') || 'none'}. A single bot needs a z of about ${num(L.bonferroniZ)} to pass that bar.`,
      `Best test-month z-scores: ${L.best
        .slice(0, 6)
        .map((x) => `${short(byId.get(x.id)!)} z ${num(x.z)} (earlier months z ${num(x.isZ)})`)
        .join('; ')}.`,
      `**Coin-flip bots** (random entries, the luckiest of 6 seeds kept in-sample): ${L.coins.positiveOos} of ${L.coins.eligible} made money in the test months and ${L.coins.positiveBoth} in both halves. Real bots: ${L.realPositiveOos} of ${L.tests} and ${L.realPositiveBoth} of ${L.tests}. The first run used the best coin flip as a "luck line"; that line was too low and has been dropped.`,
      `**Older history (2019 to 2024-11, about 6 years, 1-hour and bigger charts):** ${c.holdPositive} of ${c.holdBots} bots made money there with the settings chosen on 2024-2026; ${c.positiveAll3} made money in all three periods.`,
    ],
  })

  out.push({ h: 2, text: 'Ranking that needs both halves' })
  out.push({
    p: `Ranked by the lower of the earlier-months and test-months t-score of the average R per signal (each signal on its own, all costs), best version of each strategy and chart. A t under 2 is within luck for one bot, let alone for ${L.tests}.`,
  })
  out.push({
    table: {
      head: ['Bot', 't both', 'R earlier', 'R test', 'Test $', 'Older'],
      rows: R.top10.map((b) => [
        short(b),
        num(Math.min(b.sig!.is.t ?? -99, b.sig!.oos.t ?? -99)),
        sR(b.sig!.is.meanR),
        sR(b.sig!.oos.meanR),
        delta(b.oos.net),
        b.hold ? delta(b.hold.m.net) : 'n/a',
      ]),
    },
  })
  const luckRows = R.probablyLuck.map((id) => byId.get(id)!).filter(Boolean)
  if (luckRows.length) {
    out.push({ h: 3, text: 'Probably luck: made money in the test months after losing earlier' })
    out.push({
      table: {
        head: ['Bot', 'Earlier', 'Test'],
        rows: luckRows.map((b) => [short(b), delta(b.is.net), delta(b.oos.net)]),
      },
    })
  }

  out.push({ h: 2, text: "John's Fib" })
  const fz = R.fib.zeroCost
  out.push({
    p: 'Sell: after a big drop, 1 at the top of the last bullish candle before it, 0 at the bottom; sell the pullback at 0.786 or 0.886; stop just past 1; half off at 0, the rest at -0.272. Buy is the mirror. New this run: a swing version (the move may take 40 candles, the setup lives 60, 1 at the swing high or low), because both of your USD/JPY examples took 4 to 6 weeks of daily candles.',
  })
  out.push({
    table: {
      head: ['Chart', 'Bots', 'Made money', 'R earlier', 'R test', 'R no costs'],
      rows: R.fib.byTfStyle.map((g) => [
        `${g.key.replace('-', ' ')}`,
        String(g.eligible),
        String(g.positiveOos),
        sR(g.medianIsR),
        sR(g.medianOosR),
        `${sR(g.medianIsR0)} / ${sR(g.medianOosR0)}`,
      ]),
    },
  })
  out.push({
    table: {
      head: ['Version', 'Bots', 'Made money', 'Both halves', 'R test'],
      rows: R.fib.byVariant.map((g) => [
        R.families.find((f) => f.variant === g.key)?.name ?? g.key,
        String(g.eligible),
        String(g.positiveOos),
        String(g.positiveBoth),
        sR(g.medianOosR),
      ]),
    },
  })
  out.push({ h: 3, text: 'Before any costs' })
  out.push({
    p: 'Average R per signal with spread, slippage, commission and swap all set to zero, each signal on its own, all markets but Bitcoin, no news filter. Plus or minus is one standard error.',
  })
  out.push({
    table: {
      head: ['Version, chart', 'Earlier', 'Test'],
      rows: fz.map((z) => [
        `${R.families.find((f) => f.variant === z.variant)?.name ?? z.variant}, ${TF[z.tf]} ${STYLE[z.style]}`,
        `${sR(z.isR0)} ±${num(z.isSe)}`,
        `${sR(z.oosR0)} ±${num(z.oosSe)}`,
      ]),
    },
  })
  const fb = R.fibBest[0]
  if (fb) out.push({ cards: [botCard(fb, null)] })

  out.push({ h: 2, text: 'What the news filter did' })
  out.push({
    p: 'Each bot was run with and without the filter, out-of-sample money compared. One row per strategy, chart and single market (the pooled accounts repeat those markets); pairs with exactly the same trades are counted apart. The list now also has ISM manufacturing and services (dates by rule), and BoJ days block 02:00-04:30 and 06:00-07:00 UTC.',
  })
  out.push({
    table: {
      head: ['Filter', 'Better', 'Worse', 'Same trades', 'Chance (sign test)', 'Median change'],
      rows: Object.values(R.newsEffect).map((n) => [
        n.words,
        String(n.better),
        String(n.worse),
        String(n.identical),
        pv(n.signTestP),
        delta(n.medianDiff ?? 0),
      ]),
    },
  })

  const lb = R.bots.filter(
    (b) => b.family === 'london' && b.variant === 'lb' && b.news === 'off' && b.extras,
  )
  if (lb.length) {
    out.push({ h: 2, text: 'London breakout by season' })
    out.push({
      p: 'The live London breakout runs on fixed UTC hours (Asian range 00:00-06:00, breaks 06:00-10:00 UTC), so in UK summer it trades an hour later against London. Kept that way on purpose (it is the live rule) and split by season instead. UK clocks went back on 2026-10-25: the live race is now in winter time.',
    })
    out.push({
      table: {
        head: ['Markets', 'Summer earlier', 'Winter earlier', 'Summer test', 'Winter test'],
        rows: lb.map((b) => [
          marketsShort(b),
          `${delta(b.extras!.season.is.summer.net)} (${b.extras!.season.is.summer.trades})`,
          `${delta(b.extras!.season.is.winter.net)} (${b.extras!.season.is.winter.trades})`,
          `${delta(b.extras!.season.oos.summer.net)} (${b.extras!.season.oos.summer.trades})`,
          `${delta(b.extras!.season.oos.winter.net)} (${b.extras!.season.oos.winter.trades})`,
        ]),
      },
    })
  }

  if (R.firstRun.length) {
    out.push({ h: 2, text: "The first run's favourites, checked again" })
    out.push({ cards: R.firstRun.map((d) => botCard(d, null)) })
  }

  out.push({ h: 2, text: 'Combining them in one account' })
  out.push({
    table: {
      head: ['Account', 'Earlier', 'Test'],
      rows: R.ensembles.map((e) => [
        `${e.name}${e.id.includes('|block') ? ' (news: no new trades)' : ''}`,
        delta(e.is.net),
        `${delta(e.oos.net)} (${e.oos.trades} trades)`,
      ]),
    },
  })

  out.push({ h: 2, text: 'Every strategy at a glance' })
  out.push({
    table: {
      head: ['Strategy', 'Bots', 'Made money', 'Both halves', 'R test'],
      rows: R.families.map((f) => [
        f.name,
        String(f.eligible),
        String(f.positiveOos),
        String(f.positiveBoth),
        sR(f.medianOosR),
      ]),
    },
  })

  if (FIXES) out.push({ h: 2, text: "The reviewers' findings and what was done" }, { notes: FIXES })

  out.push({ h: 2, text: 'How it was tested' })
  out.push({
    ul: [
      `**Walk-forward.** Each bot's few settings (${Object.entries(s.params)
        .filter(([k]) => k !== 'ensemble' && k !== 'control')
        .map(([k, v]) => `${k}: ${v}`)
        .join(
          '; ',
        )}) were chosen on the first ${Math.round(s.inSampleShare * 100)}% of 2024-11 to 2026-11 and scored on the rest in a fresh $10,000 account.`,
      '**Holdout.** For 1-hour and bigger charts, the same settings also ran once on 2019 to 2024-11 (Dukascopy and Binance hourly files, 4-hour and daily candles built from them). Nothing was chosen on it. That older stretch has no news list, so the news versions behave like "no filter" there, and news spreads are not added.',
      '**Each signal on its own.** Besides the account, every planned trade was also run alone (no "one at a time", no account limits). Average R per signal, its t-score, and the cost sweep (no costs, normal, double) use that fixed set of signals, so trade order cannot move them.',
      `**Costs.** Spread and slippage per market (table), x${s.costTimes.rolloverX} spread and x2 slippage on 21:00-23:00 UTC candles (rollover), x${s.costTimes.reopenX} spread and x5 slippage on the first candle after a gap (Sunday reopen, the daily gold and US30 halt), x${s.costTimes.newsX} spread and x5 slippage on a candle with red news, x1.5 around the Asian open (23:00-01:00 UTC, forex and gold), x2.5 for US30 outside New York cash hours, and overnight swap on each weekday rollover held (Wednesday counts 3 for forex and gold, Friday for US30). Bitcoin (exchange spot) has none of these.`,
      '**Clocks.** Scalps close at the end of their session and day trades by 17:00 New York, with London and New York daylight saving. 4-hour and daily candles close at 17:00 New York (as broker and TradingView forex charts), Bitcoin on UTC.',
      '**Backtest rules** as in the race: enter at the next candle open, the stop counts first when a candle touches both, gaps fill at the open, a limit fill never reaches its target in its own candle. Drawdowns are on closed trades only, so the real drops were somewhat deeper.',
    ],
  })
  out.push({
    table: {
      head: ['Market', 'Spread', 'Slippage', 'Fee / side', 'Swap long / short a year'],
      rows: s.costs.map((m) => [
        m.label,
        m.unit === 'price' ? String(m.spread) : `${(m.spread * 100).toFixed(2)}%`,
        m.unit === 'price' ? String(m.slippage) : `${(m.slippage * 100).toFixed(2)}%`,
        `${(m.feePerSide * 100).toFixed(4)}%`,
        `${(m.swap[0] * 100).toFixed(1)}% / ${(m.swap[1] * 100).toFixed(1)}%`,
      ]),
    },
  })

  out.push({ h: 2, text: 'Files' })
  out.push({
    ul: [
      `${join(DIR, 'results.json')}: every bot (settings, both halves, the older history, per-signal stats), the top 5 and top 10 with every test trade.`,
      `${join(DIR, 'ranking.csv')} and ranking.md: the full ranking (needs both halves).`,
      `${join(DIR, 'race-new-bots.png')}: the race page on a phone with the five new accounts.`,
      `${join(DIR, 'run1-REPORT.md')}: the first run, kept for comparison.`,
      'Code: trade-hub src/lib/lab, scripts/lab, src/lib/race/labBots.ts; docs/strategy-lab.md. Rerun with `make lab`.',
    ],
  })
  return out
}

// ── markdown ─────────────────────────────────────────────
function toMd(blocks: Block[]): string {
  const lines: string[] = []
  for (const b of blocks) {
    if ('h' in b) lines.push(`${'#'.repeat(b.h)} ${b.text}`, '')
    else if ('p' in b) lines.push(b.p, '')
    else if ('notes' in b) lines.push(b.notes.trim(), '')
    else if ('ul' in b) lines.push(...b.ul.map((x) => `- ${x}`), '')
    else if ('table' in b) {
      lines.push(`| ${b.table.head.join(' | ')} |`, `|${b.table.head.map(() => '---').join('|')}|`)
      for (const r of b.table.rows) lines.push(`| ${r.join(' | ')} |`)
      lines.push('')
    } else if ('cards' in b) {
      for (const c of b.cards) lines.push(`**${c.title}**`, '', ...c.lines.map((l) => `- ${l}`), '')
    }
  }
  return lines.join('\n')
}

// ── html ─────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/([\u2212+]\u2060?\$[\d,]+)/g, '<span class="nw">$1</span>')

function notesHtml(md: string): string {
  const out: string[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`)
    list = []
  }
  for (const para of md.trim().split(/\n\s*\n/)) {
    const ls = para.split('\n')
    if (ls.every((l) => /^\s*[-*] /.test(l))) {
      list.push(...ls.map((l) => l.replace(/^\s*[-*] /, '')))
      continue
    }
    flush()
    if (/^#{1,3} /.test(ls[0])) out.push(`<h3>${inline(ls[0].replace(/^#+ /, ''))}</h3>`)
    else out.push(`<p>${inline(para.replace(/\n/g, ' '))}</p>`)
  }
  flush()
  return out.join('\n')
}

function toHtml(blocks: Block[]): string {
  const body = blocks
    .map((b) => {
      if ('h' in b) return `<h${b.h}>${inline(b.text)}</h${b.h}>`
      if ('p' in b) return `<p>${inline(b.p)}</p>`
      if ('notes' in b) return `<div class="notes">${notesHtml(b.notes)}</div>`
      if ('ul' in b) return `<ul>${b.ul.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`
      if ('table' in b) {
        const t = b.table
        // A column is right-aligned when every cell in it starts like a number.
        const isNum = t.head.map(
          (_, i) => i > 0 && t.rows.every((r) => /^[\u2212+$\d]/.test(r[i] ?? '')),
        )
        const cls = (i: number) => (isNum[i] ? ' class="n"' : '')
        return `<table${t.narrow ? ' class="narrow"' : ''}><thead><tr>${t.head.map((h, i) => `<th${cls(i)}>${inline(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      }
      return b.cards
        .map(
          (c) =>
            `<section class="card"><h3>${inline(c.title)}</h3>${c.lines.map((l, i) => `<p${i ? '' : ' class="what"'}>${inline(l)}</p>`).join('')}</section>`,
        )
        .join('\n')
    })
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Strategy lab</title>
<style>
:root { color-scheme: dark; --bg: #121314; --panel: #1b1c1e; --line: #2c2d30; --text: #e9e8e4; --muted: #a3a29c; --accent: #e7b45a; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; overflow-wrap: anywhere; }
h1 { font-size: 26px; line-height: 1.2; margin: 8px 0 12px; letter-spacing: -0.01em; }
h2 { font-size: 19px; margin: 36px 0 10px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--accent); font-weight: 600; }
h3 { font-size: 16px; margin: 20px 0 6px; }
p, li { color: var(--text); }
ul { padding-left: 20px; margin: 8px 0; }
li { margin: 6px 0; }
strong { color: #fff; font-weight: 650; }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--panel); padding: 1px 4px; border-radius: 4px; }
.notes { background: var(--panel); border-left: 3px solid var(--accent); border-radius: 8px; padding: 4px 14px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 12px 0; }
.card h3 { margin: 0 0 6px; font-size: 15px; }
.card p { margin: 6px 0; font-size: 14.5px; }
.card .what { color: var(--muted); }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13.5px; table-layout: fixed; }
th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; font-size: 12.5px; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
th:first-child, td:first-child { width: 40%; }
table.narrow th:first-child, table.narrow td:first-child { width: 2em; }
table.narrow th:nth-child(2), table.narrow td:nth-child(2) { width: 52%; }
td.n, .nw { white-space: nowrap; }
@media (max-width: 420px) { body { font-size: 15px; } table { font-size: 12.5px; } th, td { padding: 6px 4px; } }
</style>
</head>
<body>
<main>
${body}
<p style="color:var(--muted);font-size:13px;margin-top:40px">Play money only. Generated ${esc(R.generatedAt.slice(0, 16).replace('T', ' '))} UTC from results.json.</p>
</main>
</body>
</html>
`
}

MINUS = '-'
writeFileSync(join(DIR, 'REPORT.md'), toMd(build()))
MINUS = '\u2212\u2060' // minus sign + word joiner: never wraps away from its number
writeFileSync(join(DIR, 'REPORT.html'), toHtml(build()))
console.log(`report: ${join(DIR, 'REPORT.md')} and REPORT.html`)
