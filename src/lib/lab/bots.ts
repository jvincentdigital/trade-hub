// Strategy lab: every bot (strategy x variant x candle size x style x
// markets x news filter), its few free parameters, and the runner that turns
// a bot into walk-forward results. Pure apart from the data source it is given.

import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import type { Signal } from '../rules/engine'
import { portfolioBacktest, type TradeMoney } from '../race/leaderboard'
import { confirmationSeries, htfTrend } from './candles'
import { COIN_EVERY, coinFlip } from './control'
import { simulate, type LabEntry, type LabTrade } from './engine'
import { johnsFib } from './fib'
import { firstAtOrAfter, londonDirection, londonLab } from './london'
import {
  labMarket,
  marketsFor,
  spreadAt,
  TF_SEC,
  TF_WORDS,
  type LabMarketId,
  type LabTf,
} from './markets'
import { NEWS_MODES, NEWS_WORDS, newsWindows, type NewsEvent, type NewsMode } from './news'
import { labRule, LAB_RULES, ruleEntries, ruleMarkets, ruleSignals } from './rules'
import { bbWidth, scalper, squeezeRank } from './scalper'
import { inLondonSession, STYLE_WORDS, type Style } from './time'
import {
  breakdown,
  metricsOf,
  monthly,
  splitSpan,
  splitTrades,
  START_MONEY,
  walkForward,
  MIN_OOS_TRADES,
  type Metrics,
  type Span,
} from './walkforward'

export type Family = 'fib' | 'scalper' | 'london' | 'rule' | 'control' | 'ensemble'
export type Params = Record<string, number>

export interface BotSpec {
  id: string
  family: Family
  variant: string
  tf: LabTf
  style: Style
  markets: LabMarketId[]
  /** 'all' or the one market. */
  scope: string
  news: NewsMode
}

type FibFilter = 'none' | 'london-session' | 'london-direction' | 'trend'

export const FIB_VARIANTS: Record<string, { name: string; confirm: boolean; filter: FibFilter }> = {
  fib: { name: "John's Fib", confirm: false, filter: 'none' },
  'fib-candle': { name: "John's Fib + candle", confirm: true, filter: 'none' },
  'fib-london': {
    name: "John's Fib, London session only",
    confirm: false,
    filter: 'london-session',
  },
  'fib-candle-londondir': {
    name: "John's Fib + candle + London direction",
    confirm: true,
    filter: 'london-direction',
  },
  'fib-trend': { name: "John's Fib + bigger-chart trend", confirm: false, filter: 'trend' },
  'fib-candle-trend': {
    name: "John's Fib + candle + bigger-chart trend",
    confirm: true,
    filter: 'trend',
  },
}

const FIB_TF_STYLES: [LabTf, Style][] = [
  ['5m', 'scalp'],
  ['15m', 'scalp'],
  ['15m', 'day'],
  ['30m', 'day'],
  ['1h', 'day'],
  ['4h', 'swing'],
  ['1d', 'swing'],
]

/** Bigger chart for the trend filter. */
export const HTF: Partial<Record<LabTf, LabTf>> = {
  '5m': '4h',
  '15m': '4h',
  '30m': '4h',
  '1h': '4h',
  '4h': '1d',
}

export const LONDON_VARIANTS: Record<string, { name: string; fade: boolean }> = {
  lb: { name: 'London breakout (race rules)', fade: false },
  'lb-fade': { name: 'London breakout, faded (stop hunt)', fade: true },
}
const LONDON_MARKETS: LabMarketId[] = ['GBPUSD', 'XAUUSD']

export const SCALPER_NAME = 'Consolidation scalper'

export function paramGrid(family: Family, variant: string): Params[] {
  switch (family) {
    case 'fib':
      return [2, 3, 4].flatMap((k) => [0.786, 0.886].map((entry) => ({ k, entry })))
    case 'scalper':
      return [0, 1].flatMap((far) => [0.2, 0.35].map((squeeze) => ({ far, squeeze })))
    case 'london':
      return (variant === 'lb-fade' ? [1, 1.5, 2] : [1.5, 2, 3]).map((rr) => ({ rr }))
    case 'rule':
      return [1.5, 2, 3].map((rr) => ({ rr }))
    case 'control':
      return [1, 2, 3, 4, 5, 6].map((seed) => ({ seed }))
    case 'ensemble':
      return [{}]
  }
}

export const PARAM_WORDS: Record<Family, string> = {
  fib: 'k = impulse size in ATRs (2, 3, 4); entry = 0.786 or 0.886',
  scalper: 'far = target the middle (0) or the far edge (1); squeeze = 0.2 or 0.35',
  london: 'rr = target in stop distances (1.5, 2, 3; faded: 1, 1.5, 2)',
  rule: 'rr = target in stop distances (1.5, 2, 3)',
  control: 'seed = which random sequence (1-6); the luckiest in-sample one is kept',
  ensemble: 'each part keeps the parameters it chose on its own in-sample run',
}

const botId = (variant: string, tf: LabTf, style: Style, scope: string, news: NewsMode) =>
  `${variant}|${tf}-${style}|${scope}|${news}`

function scopes(markets: LabMarketId[]): [string, LabMarketId[]][] {
  const one = markets.map((m) => [m, [m]] as [string, LabMarketId[]])
  return markets.length > 1 ? [['all', markets], ...one] : one
}

/** The whole matrix. */
export function allBotSpecs(): BotSpec[] {
  const out: BotSpec[] = []
  const add = (
    family: Family,
    variant: string,
    tf: LabTf,
    style: Style,
    markets: LabMarketId[],
    news: NewsMode[],
  ) => {
    for (const [scope, ms] of scopes(markets))
      for (const n of news)
        out.push({
          id: botId(variant, tf, style, scope, n),
          family,
          variant,
          tf,
          style,
          markets: ms,
          scope,
          news: n,
        })
  }
  for (const [variant, v] of Object.entries(FIB_VARIANTS)) {
    for (const [tf, style] of FIB_TF_STYLES) {
      const small = TF_SEC[tf] <= 3600
      if ((v.filter === 'london-session' || v.filter === 'london-direction') && !small) continue
      if (v.filter === 'trend' && !HTF[tf]) continue
      add('fib', variant, tf, style, marketsFor(tf), NEWS_MODES)
    }
  }
  for (const tf of ['5m', '15m'] as LabTf[])
    add('scalper', 'scalper', tf, 'scalp', marketsFor(tf), [...NEWS_MODES, 'day'])
  for (const variant of Object.keys(LONDON_VARIANTS))
    add('london', variant, '15m', 'day', LONDON_MARKETS, NEWS_MODES)
  for (const rule of LAB_RULES)
    add(
      'rule',
      rule.id,
      rule.timeframe,
      'race',
      ruleMarkets(rule, marketsFor(rule.timeframe)),
      NEWS_MODES,
    )
  for (const [tf, style] of FIB_TF_STYLES)
    add('control', 'coin-flip', tf, style, marketsFor(tf), ['off'])
  return out
}

export function botName(spec: Pick<BotSpec, 'family' | 'variant' | 'tf'>): string {
  switch (spec.family) {
    case 'fib': {
      const n = FIB_VARIANTS[spec.variant].name
      return n.replace('bigger-chart', HTF[spec.tf] ?? 'bigger-chart')
    }
    case 'scalper':
      return SCALPER_NAME
    case 'london':
      return LONDON_VARIANTS[spec.variant].name
    case 'rule':
      return labRule(spec.variant).name
    case 'control':
      return 'Coin flip (luck check)'
    case 'ensemble':
      return spec.variant
  }
}

export const marketsWords = (ms: LabMarketId[]) => ms.map((m) => labMarket(m).label).join(', ')

/** One line in plain words: what the bot does. */
export function describeBot(spec: BotSpec, p: Params): string {
  const tail = `${TF_WORDS[spec.tf]} candles, ${STYLE_WORDS[spec.style].split(':')[0]}; ${marketsWords(spec.markets)}; ${NEWS_WORDS[spec.news]}`
  switch (spec.family) {
    case 'fib': {
      const v = FIB_VARIANTS[spec.variant]
      const how = v.confirm
        ? `waits for a reversal candle that reaches ${p.entry} of the pullback, enters at the next open`
        : `limit order at ${p.entry} of the pullback`
      const filter = {
        none: '',
        'london-session': ', only 08:00-16:00 London time',
        'london-direction': ', only the way London broke the Asian range that day',
        trend: `, only with the ${HTF[spec.tf]} trend (EMA 50)`,
      }[v.filter]
      return `After a move of ${p.k}x ATR within 12 candles, ${how}${filter}; stop past 1, half off at 0, rest at -0.272. ${tail}`
    }
    case 'scalper':
      return `In a quiet range (Bollinger squeeze, lowest ${p.squeeze * 100}%), fades the edge on a reversal candle, stop just past it, target the ${p.far ? 'far edge' : 'middle'}; stops after a breakout. ${tail}`
    case 'london':
      return `${LONDON_VARIANTS[spec.variant].fade ? 'Trades AGAINST' : 'Trades'} the first 15-minute close outside the Asian range (06:00-10:00 UTC), stop as the race, target ${p.rr}x. ${tail}`
    case 'rule':
      return `${labRule(spec.variant).summary} Target ${p.rr}x the stop. ${tail}`
    case 'control':
      return `Random entries (seed ${p.seed}, about 1 in ${COIN_EVERY} candles), stop 1.5x ATR, target 2x: no edge by design. ${tail}`
    case 'ensemble':
      return tail
  }
}

export interface LabData {
  candles(m: LabMarketId, tf: LabTf): Promise<OHLCCandle[]>
  news: NewsEvent[]
}

interface Series {
  c: OHLCCandle[]
  atr?: number[]
  conf?: Int8Array
  ranks?: number[]
  ldir?: Int8Array
  trend?: Int8Array
  rules?: Map<string, Signal[]>
}

export interface CompactTrade {
  market: string
  dir: 'long' | 'short'
  entryTime: string
  exitTime: string
  entry: number
  exit: number
  stop: number
  target: number
  units: number
  riskUsd: number
  pnl: number
  r: number
  why: string
  balanceAtEntry: number
}

export interface BotResult {
  id: string
  family: Family
  variant: string
  name: string
  what: string
  tf: LabTf
  style: Style
  scope: string
  markets: LabMarketId[]
  news: NewsMode
  params: Params
  grid: { params: Params; isNet: number; isTrades: number }[]
  span: Span
  is: Metrics
  oos: Metrics
  eligible: boolean
  parts?: string[]
}

export interface BotDetail {
  id: string
  oosTrades: CompactTrade[]
  byMarket: Record<string, { trades: number; net: number; wins: number }>
  bySession: Record<string, { trades: number; net: number; wins: number }>
  monthly: Record<string, number>
  /** Out-of-sample net with no costs at all, and with double costs. */
  costs: { free: number; normal: number; double: number }
  /** Out-of-sample balance after each close. */
  curve: number[]
}

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16) + 'Z'

export function compact(t: TradeMoney & Partial<LabTrade>): CompactTrade {
  return {
    market: t.market,
    dir: t.direction,
    entryTime: iso(t.entryTime),
    exitTime: iso(t.exitTime),
    entry: t.entry,
    exit: t.exit,
    stop: t.stop,
    target: t.takeProfit,
    units: t.units,
    riskUsd: Math.round(t.riskUsd * 100) / 100,
    pnl: Math.round(t.pnl * 100) / 100,
    r: Math.round((t.riskUsd > 0 ? t.pnl / t.riskUsd : 0) * 100) / 100,
    why: t.why ?? t.reason,
    balanceAtEntry: Math.round(t.balanceAtEntry * 100) / 100,
  }
}

/** Loads what a bot needs, plans its trades and runs them; caches by market and candle size. */
export class LabRunner {
  private series = new Map<string, Series>()
  private entryCache = new Map<string, LabEntry[]>()
  constructor(private data: LabData) {}

  private async load(m: LabMarketId, tf: LabTf): Promise<Series> {
    const key = `${m}|${tf}`
    let s = this.series.get(key)
    if (!s) {
      s = { c: await this.data.candles(m, tf) }
      this.series.set(key, s)
    }
    return s
  }

  private get(m: LabMarketId, tf: LabTf): Series {
    const s = this.series.get(`${m}|${tf}`)
    if (!s) throw new Error(`not loaded: ${m} ${tf}`)
    return s
  }

  /** Load every series the bot reads. */
  async prepare(spec: BotSpec): Promise<void> {
    for (const m of spec.markets) {
      await this.load(m, spec.tf)
      if (spec.family === 'london') await this.load(m, '1h')
      if (spec.family === 'fib' && FIB_VARIANTS[spec.variant].filter === 'trend')
        await this.load(m, HTF[spec.tf]!)
      if (m === 'EURGBP') await this.load('GBPUSD', '1h')
    }
  }

  span(spec: BotSpec): Span {
    const ss = spec.markets.map((m) => this.get(m, spec.tf).c)
    return splitSpan(
      Math.max(...ss.map((c) => c[0].time)),
      Math.min(...ss.map((c) => c[c.length - 1].time)),
    )
  }

  private usdPerQuote(m: LabMarketId): ((t: number, price: number) => number) | undefined {
    if (m === 'USDJPY') return (_t, price) => 1 / price
    if (m === 'EURGBP') {
      const g = this.get('GBPUSD', '1h').c
      return (t) => g[Math.max(0, firstAtOrAfter(g, t + 1) - 1)].close
    }
    return undefined
  }

  private entries(spec: BotSpec, m: LabMarketId, p: Params, costMult: number): LabEntry[] {
    const key = `${spec.family}|${spec.variant}|${spec.tf}|${m}|${JSON.stringify(p)}|${spec.family === 'fib' ? costMult : 1}`
    const hit = this.entryCache.get(key)
    if (hit) return hit
    const s = this.get(m, spec.tf)
    const c = s.c
    let out: LabEntry[]
    switch (spec.family) {
      case 'fib': {
        const v = FIB_VARIANTS[spec.variant]
        s.atr ??= atrSeries(c, 14)
        if (v.confirm) s.conf ??= confirmationSeries(c)
        let allow: ((i: number, long: boolean) => boolean) | undefined
        if (v.filter === 'london-session') allow = (i) => inLondonSession(c[i].time)
        if (v.filter === 'london-direction') {
          const ld = (s.ldir ??= londonDirection(c, TF_SEC[spec.tf]))
          allow = (i, long) => ld[i] === (long ? 1 : -1)
        }
        if (v.filter === 'trend') {
          const h = HTF[spec.tf]!
          const tr = (s.trend ??= htfTrend(c, TF_SEC[spec.tf], this.get(m, h).c, TF_SEC[h]))
          allow = (i, long) => tr[i] === (long ? 1 : -1)
        }
        const mk = labMarket(m)
        out = johnsFib(c, {
          k: p.k,
          entry: p.entry,
          confirm: v.confirm,
          confirmations: s.conf,
          spreadOf: (price) => spreadAt(mk, price, costMult),
          allow,
          atr: s.atr,
        })
        break
      }
      case 'scalper': {
        s.atr ??= atrSeries(c, 14)
        s.conf ??= confirmationSeries(c)
        s.ranks ??= squeezeRank(bbWidth(c))
        out = scalper(c, {
          far: p.far as 0 | 1,
          squeeze: p.squeeze,
          confirmations: s.conf,
          atr: s.atr,
          ranks: s.ranks,
        })
        break
      }
      case 'london':
        out = londonLab(c, this.get(m, '1h').c, {
          rr: p.rr,
          fade: LONDON_VARIANTS[spec.variant].fade,
          leverage: labMarket(m).leverage,
        })
        break
      case 'rule': {
        s.rules ??= new Map()
        let sig = s.rules.get(spec.variant)
        if (!sig) {
          sig = ruleSignals(labRule(spec.variant), c)
          s.rules.set(spec.variant, sig)
        }
        out = ruleEntries(sig, p.rr, c.length)
        break
      }
      case 'control':
        s.atr ??= atrSeries(c, 14)
        out = coinFlip(c, p.seed, s.atr)
        break
      case 'ensemble':
        out = []
    }
    this.entryCache.set(key, out)
    return out
  }

  /** Every trade the bot takes with parameters p over the whole history, all its markets. */
  trades(spec: BotSpec, p: Params, costMult = 1): LabTrade[] {
    const out: LabTrade[] = []
    for (const m of spec.markets) {
      const mk = labMarket(m)
      out.push(
        ...simulate(this.get(m, spec.tf).c, this.entries(spec, m, p, costMult), {
          market: mk,
          tf: spec.tf,
          style: spec.style,
          news: spec.news,
          windows: newsWindows(this.data.news, mk.currencies, spec.news),
          costMult,
          usdPerQuote: this.usdPerQuote(m),
        }),
      )
    }
    return out
  }

  async run(spec: BotSpec): Promise<BotResult & { walk: ReturnType<typeof walkForward<Params>> }> {
    await this.prepare(spec)
    const span = this.span(spec)
    const walk = walkForward(span, paramGrid(spec.family, spec.variant), (p) =>
      this.trades(spec, p),
    )
    return {
      id: spec.id,
      family: spec.family,
      variant: spec.variant,
      name: botName(spec),
      what: describeBot(spec, walk.params),
      tf: spec.tf,
      style: spec.style,
      scope: spec.scope,
      markets: spec.markets,
      news: spec.news,
      params: walk.params,
      grid: walk.grid.map((g) => ({ ...g, isNet: Math.round(g.isNet * 100) / 100 })),
      span,
      is: walk.is,
      oos: walk.oos,
      eligible: walk.oos.trades >= MIN_OOS_TRADES,
      walk,
    }
  }

  async result(spec: BotSpec): Promise<BotResult> {
    const { walk: _walk, ...r } = await this.run(spec)
    void _walk
    return r
  }

  /** Out-of-sample details for the report: trades, markets, sessions, months, cost check. */
  async detail(spec: BotSpec): Promise<BotResult & { detail: BotDetail }> {
    const r = await this.run(spec)
    const p = r.walk.params
    const oosNet = (mult: number) =>
      portfolioBacktest(START_MONEY, splitTrades(this.trades(spec, p, mult), r.span).oos).end -
      START_MONEY
    const { walk, ...rest } = r
    const curve = portfolioBacktest(
      START_MONEY,
      splitTrades(this.trades(spec, p), r.span).oos,
    ).curve
    return {
      ...rest,
      detail: {
        id: spec.id,
        oosTrades: walk.oosTrades.map(compact),
        ...breakdown(walk.oosTrades),
        monthly: monthly(walk.oosTrades, r.span.split, r.span.to),
        costs: { free: oosNet(0), normal: r.oos.net, double: oosNet(2) },
        curve: curve.map((x) => Math.round(x * 100) / 100),
      },
    }
  }
}

export interface EnsemblePart {
  spec: BotSpec
  params?: Params
}

/**
 * Several bots in ONE $10,000 account: each part keeps the parameters it
 * chose on its own in-sample run, their trades merge in time order under the
 * race's limits, scored on the span all parts share.
 */
export async function runEnsemble(
  runner: LabRunner,
  id: string,
  name: string,
  parts: EnsemblePart[],
): Promise<BotResult & { detail: BotDetail }> {
  const trades: LabTrade[] = []
  const spans: Span[] = []
  const chosen: Params[] = []
  for (const part of parts) {
    const r = await runner.run(part.spec)
    const p = part.params ?? r.params
    trades.push(...runner.trades(part.spec, p))
    spans.push(r.span)
    chosen.push(p)
  }
  const span = splitSpan(Math.max(...spans.map((s) => s.from)), Math.min(...spans.map((s) => s.to)))
  const { is, oos } = splitTrades(trades, span)
  const isRun = portfolioBacktest(START_MONEY, is)
  const oosRun = portfolioBacktest(START_MONEY, oos)
  const markets = [...new Set(parts.flatMap((x) => x.spec.markets))]
  const tfs = [...new Set(parts.map((x) => x.spec.tf))]
  const ism = metricsOf(isRun, span.from, span.split)
  const oosm = metricsOf(oosRun, span.split, span.to)
  const costNet = (mult: number) => {
    const all = parts.flatMap((part, i) => runner.trades(part.spec, chosen[i], mult))
    return portfolioBacktest(START_MONEY, splitTrades(all, span).oos).end - START_MONEY
  }
  return {
    id,
    family: 'ensemble',
    variant: id,
    name,
    what: `One $10,000 account for: ${parts.map((x) => botName(x.spec) + ` (${TF_WORDS[x.spec.tf]}, ${x.spec.scope})`).join(' + ')}. ${marketsWords(markets)}.`,
    tf: tfs[0],
    style: parts[0].spec.style,
    scope: 'mixed',
    markets,
    news: parts[0].spec.news,
    params: {},
    grid: [],
    span,
    is: ism,
    oos: oosm,
    eligible: oosm.trades >= MIN_OOS_TRADES,
    parts: parts.map((x, i) => `${x.spec.id} ${JSON.stringify(chosen[i])}`),
    detail: {
      id,
      oosTrades: oosRun.trades.map(compact),
      ...breakdown(oosRun.trades),
      monthly: monthly(oosRun.trades, span.split, span.to),
      costs: { free: costNet(0), normal: oosm.net, double: costNet(2) },
      curve: oosRun.curve.map((x) => Math.round(x * 100) / 100),
    },
  }
}
