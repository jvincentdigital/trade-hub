// Strategy lab: every bot (strategy x variant x candle size x style x
// markets x news filter), its few free parameters, and the runner that turns
// a bot into walk-forward results. Pure apart from the data source it is given.

import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import { findSignals, type Signal } from '../rules/engine'
import type { Rule } from '../rules/schema'
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
import {
  NEWS_MODES,
  NEWS_WORDS,
  newsWindows,
  spikeWindows,
  type NewsEvent,
  type NewsMode,
  type Window,
} from './news'
import { labRule, LAB_RULES, ruleEntries, ruleMarkets, ruleSignals } from './rules'
import { bbWidth, scalper, squeezeRank } from './scalper'
import { bootstrapCi, directionTest, meanSe } from './stats'
import { inLondonSession, seasonOf, STYLE_WORDS, type Style } from './time'
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

export const FIB_VARIANTS: Record<
  string,
  { name: string; confirm: boolean; filter: FibFilter; swing?: boolean }
> = {
  fib: { name: "John's Fib", confirm: false, filter: 'none' },
  'fib-swing': { name: "John's Fib, swing anchors", confirm: false, filter: 'none', swing: true },
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
/** The swing version's swings take weeks, so its trades may stay 5 days (1h) or 30 days (4h, daily). */
const FIB_SWING_TF_STYLES: [LabTf, Style][] = [
  ['1h', 'swing'],
  ['4h', 'position'],
  ['1d', 'position'],
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
      return (variant === 'fib-swing' ? [3, 4.5, 6] : [2, 3, 4]).flatMap((k) =>
        [0.786, 0.886].map((entry) => ({ k, entry })),
      )
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
  fib: 'k = impulse size in ATRs (2, 3, 4; swing anchors: 3, 4.5, 6); entry = 0.786 or 0.886',
  scalper: 'far = target the middle (0) or the far edge (1); squeeze = 0.2 or 0.35',
  london: 'rr = target in stop distances (1.5, 2, 3; faded: 1, 1.5, 2)',
  rule: 'rr = target in stop distances (1.5, 2, 3)',
  control: 'seed = which random sequence (1-6); the luckiest in-sample one is kept',
  ensemble: 'each part keeps the parameters it chose on its own in-sample run',
}

const botId = (variant: string, tf: LabTf, style: Style, scope: string, news: NewsMode) =>
  `${variant}|${tf}-${style}|${scope}|${news}`

/**
 * "all" (every market but Bitcoin in one account) and each market alone.
 * Bitcoin runs only in its own account: at 1:1 its full-value margin blocked
 * the other markets and its 2% trades were sized far below 2%.
 */
function scopes(markets: LabMarketId[]): [string, LabMarketId[]][] {
  const one = markets.map((m) => [m, [m]] as [string, LabMarketId[]])
  const pooled = markets.filter((m) => m !== 'BTCUSDT')
  return pooled.length > 1 ? [['all', pooled], ...one] : one
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
    for (const [tf, style] of v.swing ? FIB_SWING_TF_STYLES : FIB_TF_STYLES) {
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
      const move = v.swing
        ? `After a swing of ${p.k}x ATR within 40 candles (1 at the swing high or low, setup lives 60 candles)`
        : `After a move of ${p.k}x ATR within 12 candles`
      return `${move}, ${how}${filter}; stop past 1, half off at 0, rest at -0.272. ${tail}`
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
  nights: number
  weekend: boolean
}

/** Results of every planned trade simulated on its own (no account, no "one at a time"). */
export interface SigStats {
  n: number
  /** Average R after all costs (time-of-day spreads, swap). */
  meanR: number | null
  se: number | null
  t: number | null
  /** Same signals with no costs at all, and with double costs. */
  meanR0: number | null
  meanR2: number | null
  /** Random-direction test: z and one-sided p (does the side the bot picks beat a coin flip at the same times?). */
  z: number | null
  p: number | null
  long: { n: number; meanR: number | null }
  short: { n: number; meanR: number | null }
}

export interface Split2 {
  trades: number
  net: number
}

/** Account extras for the report: fragility, seasons, sides, weekends. */
export interface Extras {
  /** Out-of-sample net without its 3 best trades. */
  oosWithoutTop3: number
  /** Bootstrap 95% interval of the out-of-sample average R per account trade. */
  oosCi95: [number, number] | null
  /** Out-of-sample net of the trades held over a weekend, and their count. */
  oosWeekend: Split2
  season: { is: Record<'summer' | 'winter', Split2>; oos: Record<'summer' | 'winter', Split2> }
  side: { is: Record<'long' | 'short', Split2>; oos: Record<'long' | 'short', Split2> }
  /** Same out-of-sample trades (market, entry, side, dollars): bots with the same key are copies. */
  sig: string
}

export interface Holdout {
  span: { from: number; to: number }
  m: Metrics
  sig: SigStats
  season: Record<'summer' | 'winter', Split2>
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
  sig?: { is: SigStats; oos: SigStats }
  extras?: Extras
  /** Older history (2019 to 2024-11) with the settings chosen in-sample: never used to pick anything. */
  hold?: Holdout | null
  parts?: string[]
}

export interface Neighbour {
  label: string
  isR: number | null
  oosR: number | null
  isN: number
  oosN: number
  isT: number | null
  oosT: number | null
}

export interface BotDetail {
  id: string
  oosTrades: CompactTrade[]
  byMarket: Record<string, { trades: number; net: number; wins: number }>
  bySession: Record<string, { trades: number; net: number; wins: number }>
  monthly: Record<string, number>
  /** Out-of-sample average R per signal with no costs, normal and double costs (the same signals). */
  costs: { r0: number | null; r1: number | null; r2: number | null }
  /** Out-of-sample net with the first run's flat costs (no rollover, reopen or news spreads, no swap). */
  flatCostNet: number
  /** Out-of-sample balance after each close. */
  curve: number[]
  /** Nearby settings, each signal on its own: does the result hold when a setting moves a little? */
  neighbours: Neighbour[]
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
    nights: t.nights ?? 0,
    weekend: !!t.weekend,
  }
}

export interface TradeOpts {
  costMult?: number
  /** Every entry on its own. */
  independent?: boolean
  /** The first run's flat costs. */
  flat?: boolean
  /** The opposite trade at every entry (stop and target mirrored around the entry price). */
  flip?: boolean
  /** Limit fills check exits from the next candle (the random-direction test, both sides). */
  limitFromNext?: boolean
}

/** The opposite trade: same candle, levels mirrored around the price it enters at. */
export function flipEntry(c: OHLCCandle[], e: LabEntry): LabEntry {
  const ref = e.kind === 'limit' && e.price != null ? e.price : c[e.i].open
  const m = (x: number) => 2 * ref - x
  return {
    ...e,
    direction: e.direction === 'long' ? 'short' : 'long',
    stop: m(e.stop),
    target: m(e.target),
    ...(e.target1 != null ? { target1: m(e.target1) } : {}),
  }
}

const flipKey = (t: LabTrade, flipped: boolean) =>
  `${t.market}|${t.entryTime}|${flipped ? (t.direction === 'long' ? 'short' : 'long') : t.direction}`

/** `pair` and `flip`: the real and mirrored trades under the same fill-candle rule (TradeOpts.limitFromNext). */
function sigStats(
  real: LabTrade[],
  zero: LabTrade[],
  dbl: LabTrade[],
  pair: LabTrade[],
  flip: LabTrade[],
): SigStats {
  const rs = real.map((t) => t.r)
  const m = meanSe(rs)
  const f = new Map(flip.map((t) => [flipKey(t, true), t.r]))
  const a: number[] = []
  const b: number[] = []
  for (const t of pair) {
    const x = f.get(flipKey(t, false))
    if (x == null) continue
    a.push(t.r)
    b.push(x)
  }
  const d = directionTest(a, b)
  const side = (dir: 'long' | 'short') => {
    const x = meanSe(real.filter((t) => t.direction === dir).map((t) => t.r))
    return { n: x.n, meanR: x.mean }
  }
  return {
    n: m.n,
    meanR: m.mean,
    se: m.se,
    t: m.t,
    meanR0: meanSe(zero.map((t) => t.r)).mean,
    meanR2: meanSe(dbl.map((t) => t.r)).mean,
    z: d.z,
    p: d.p,
    long: side('long'),
    short: side('short'),
  }
}

const split2 = <K extends string>(
  trades: TradeMoney[],
  key: (t: TradeMoney) => K,
  keys: K[],
): Record<K, Split2> => {
  const out = Object.fromEntries(keys.map((k) => [k, { trades: 0, net: 0 }])) as Record<K, Split2>
  for (const t of trades) {
    const r = out[key(t)]
    r.trades++
    r.net += t.pnl
  }
  return out
}

const SEASONS: ('summer' | 'winter')[] = ['summer', 'winter']
const SIDES: ('long' | 'short')[] = ['long', 'short']

function extrasOf(isTrades: TradeMoney[], oosTrades: TradeMoney[], oosNet: number): Extras {
  const top3 = [...oosTrades]
    .map((t) => t.pnl)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .filter((x) => x > 0)
    .reduce((a, b) => a + b, 0)
  const weekend = oosTrades.filter((t) => (t as TradeMoney & Partial<LabTrade>).weekend)
  const season = (t: TradeMoney) => seasonOf(t.entryTime)
  const side = (t: TradeMoney) => t.direction
  return {
    oosWithoutTop3: oosNet - top3,
    oosCi95: bootstrapCi(oosTrades.map((t) => (t.riskUsd > 0 ? t.pnl / t.riskUsd : 0))),
    oosWeekend: { trades: weekend.length, net: weekend.reduce((a, t) => a + t.pnl, 0) },
    season: { is: split2(isTrades, season, SEASONS), oos: split2(oosTrades, season, SEASONS) },
    side: { is: split2(isTrades, side, SIDES), oos: split2(oosTrades, side, SIDES) },
    sig: oosTrades
      .map((t) => `${t.market}${t.entryTime}${t.direction[0]}${Math.round(t.pnl)}`)
      .sort()
      .join(','),
  }
}

/** Nearby versions of a race rule: stop buffer, RSI levels, without the candle condition. */
export function ruleNeighbours(rule: Rule): { label: string; rule: Rule }[] {
  const out: { label: string; rule: Rule }[] = []
  const st = rule.stop
  if (st.kind === 'swing')
    for (const d of [-0.2, -0.1, 0.1, 0.2]) {
      const b = Math.round((st.bufferPct + d) * 100) / 100
      if (b >= 0)
        out.push({ label: `stop buffer ${b}%`, rule: { ...rule, stop: { ...st, bufferPct: b } } })
    }
  const rsi = rule.conditions.findIndex((c) => c.kind === 'rsi')
  if (rsi >= 0) {
    const c = rule.conditions[rsi]
    if (c.kind === 'rsi')
      for (const d of [-5, 5]) {
        const conditions = [...rule.conditions]
        conditions[rsi] = { ...c, longBelow: c.longBelow + d, shortAbove: c.shortAbove - d }
        out.push({
          label: `RSI ${c.longBelow + d}/${c.shortAbove - d}`,
          rule: { ...rule, conditions },
        })
      }
  }
  if (rule.conditions.some((c) => c.kind === 'pattern'))
    out.push({
      label: 'without the candle condition',
      rule: { ...rule, conditions: rule.conditions.filter((c) => c.kind !== 'pattern') },
    })
  return out
}

/** Loads what a bot needs, plans its trades and runs them; caches by market and candle size. */
export class LabRunner {
  private series = new Map<string, Series>()
  private entryCache = new Map<string, LabEntry[]>()
  private spikeCache = new Map<string, Window[]>()
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

  /**
   * USD per unit of the quote currency at a time and price: USD/JPY 1/price
   * (so the P&L converts at the exit rate), EUR/GBP the close of the last
   * GBP/USD 1h candle that had closed by then (never a later one).
   */
  private usdPerQuote(m: LabMarketId): ((t: number, price: number) => number) | undefined {
    if (m === 'USDJPY') return (_t, price) => 1 / price
    if (m === 'EURGBP') {
      const g = this.get('GBPUSD', '1h').c
      return (t) => g[Math.max(0, firstAtOrAfter(g, t - 3599) - 1)].close
    }
    return undefined
  }

  private spikes(m: LabMarketId): Window[] {
    let w = this.spikeCache.get(m)
    if (!w) {
      w = spikeWindows(this.data.news, labMarket(m).currencies)
      this.spikeCache.set(m, w)
    }
    return w
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
          swing: v.swing,
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

  private sim(spec: BotSpec, m: LabMarketId, entries: LabEntry[], o: TradeOpts): LabTrade[] {
    const mk = labMarket(m)
    const c = this.get(m, spec.tf).c
    return simulate(c, o.flip ? entries.map((e) => flipEntry(c, e)) : entries, {
      market: mk,
      tf: spec.tf,
      style: spec.style,
      news: spec.news,
      windows: newsWindows(this.data.news, mk.currencies, spec.news),
      costMult: o.costMult ?? 1,
      usdPerQuote: this.usdPerQuote(m),
      spikes: this.spikes(m),
      flatCosts: o.flat,
      independent: o.independent,
      limitFromNext: o.limitFromNext,
    })
  }

  /** Every trade the bot takes with parameters p over the whole history, all its markets. */
  trades(spec: BotSpec, p: Params, o: TradeOpts = {}): LabTrade[] {
    const out: LabTrade[] = []
    for (const m of spec.markets)
      out.push(...this.sim(spec, m, this.entries(spec, m, p, o.costMult ?? 1), o))
    return out
  }

  /** Trades of a race rule other than the built-in one (neighbour grid), every signal on its own. */
  private ruleVariantTrades(spec: BotSpec, rule: Rule, rr: number): LabTrade[] {
    const out: LabTrade[] = []
    for (const m of spec.markets) {
      const c = this.get(m, spec.tf).c
      out.push(
        ...this.sim(spec, m, ruleEntries(findSignals(rule, c), rr, c.length), {
          independent: true,
        }),
      )
    }
    return out
  }

  /** Each signal on its own, in-sample and out-of-sample: costs 1, 0, 2 and the flipped side. */
  sigOf(spec: BotSpec, p: Params, span: Span): { is: SigStats; oos: SigStats } {
    const run = (o: TradeOpts) =>
      splitTrades(this.trades(spec, p, { ...o, independent: true }), span)
    const r1 = run({})
    const r0 = run({ costMult: 0 })
    const r2 = run({ costMult: 2 })
    const pr = run({ limitFromNext: true })
    const f = run({ flip: true, limitFromNext: true })
    return {
      is: sigStats(r1.is, r0.is, r2.is, pr.is, f.is),
      oos: sigStats(r1.oos, r0.oos, r2.oos, pr.oos, f.oos),
    }
  }

  async run(spec: BotSpec): Promise<BotResult & { walk: ReturnType<typeof walkForward<Params>> }> {
    await this.prepare(spec)
    const span = this.span(spec)
    const walk = walkForward(span, paramGrid(spec.family, spec.variant), (p) =>
      this.trades(spec, p),
    )
    const full = spec.family !== 'ensemble'
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
      ...(full
        ? {
            sig: this.sigOf(spec, walk.params, span),
            extras: extrasOf(walk.isTrades, walk.oosTrades, walk.oos.net),
          }
        : {}),
      walk,
    }
  }

  /** The bot on this runner's whole history with fixed settings (the holdout on older data). */
  async holdout(spec: BotSpec, p: Params): Promise<Holdout | null> {
    try {
      await this.prepare(spec)
    } catch {
      return null // no older history for this market or candle size
    }
    const sp = this.span(spec)
    const all = splitSpan(sp.from, sp.to, 1)
    const trades = splitTrades(this.trades(spec, p), all).is
    const run = portfolioBacktest(START_MONEY, trades)
    const one = (o: TradeOpts) =>
      splitTrades(this.trades(spec, p, { ...o, independent: true }), all).is
    return {
      span: { from: sp.from, to: sp.to },
      m: metricsOf(run, sp.from, sp.to),
      sig: sigStats(
        one({}),
        one({ costMult: 0 }),
        one({ costMult: 2 }),
        one({ limitFromNext: true }),
        one({ flip: true, limitFromNext: true }),
      ),
      season: split2(run.trades, (t) => seasonOf(t.entryTime), SEASONS),
    }
  }

  async result(spec: BotSpec, old?: LabRunner): Promise<BotResult> {
    const { walk: _walk, ...r } = await this.run(spec)
    void _walk
    const big = spec.tf === '1h' || spec.tf === '4h' || spec.tf === '1d'
    if (old && big && spec.family !== 'control') r.hold = await old.holdout(spec, r.params)
    return r
  }

  /** Out-of-sample details for the report: trades, markets, sessions, months, costs, neighbours. */
  async detail(spec: BotSpec, old?: LabRunner): Promise<BotResult & { detail: BotDetail }> {
    const r = await this.run(spec)
    const p = r.walk.params
    const { walk, ...rest } = r
    const big = spec.tf === '1h' || spec.tf === '4h' || spec.tf === '1d'
    const hold = old && big ? await old.holdout(spec, p) : null
    const curve = portfolioBacktest(
      START_MONEY,
      splitTrades(this.trades(spec, p), r.span).oos,
    ).curve
    const flatCostNet =
      portfolioBacktest(START_MONEY, splitTrades(this.trades(spec, p, { flat: true }), r.span).oos)
        .end - START_MONEY
    const nb = (label: string, ts: LabTrade[]): Neighbour => {
      const x = splitTrades(ts, r.span)
      const a = meanSe(x.is.map((t) => t.r))
      const b = meanSe(x.oos.map((t) => t.r))
      return { label, isR: a.mean, oosR: b.mean, isN: a.n, oosN: b.n, isT: a.t, oosT: b.t }
    }
    const neighbours: Neighbour[] = paramGrid(spec.family, spec.variant).map((q) =>
      nb(JSON.stringify(q).replace(/[{}"]/g, ''), this.trades(spec, q, { independent: true })),
    )
    if (spec.family === 'rule')
      for (const n of ruleNeighbours(labRule(spec.variant)))
        neighbours.push(nb(n.label, this.ruleVariantTrades(spec, n.rule, p.rr)))
    return {
      ...rest,
      hold,
      detail: {
        id: spec.id,
        oosTrades: walk.oosTrades.map(compact),
        ...breakdown(walk.oosTrades),
        monthly: monthly(walk.oosTrades, r.span.split, r.span.to),
        costs: { r0: r.sig!.oos.meanR0, r1: r.sig!.oos.meanR, r2: r.sig!.oos.meanR2 },
        flatCostNet,
        curve: curve.map((x) => Math.round(x * 100) / 100),
        neighbours,
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
  const sigR = (mult: number) => {
    const all = parts.flatMap((part, i) =>
      runner.trades(part.spec, chosen[i], { costMult: mult, independent: true }),
    )
    return meanSe(splitTrades(all, span).oos.map((t) => t.r)).mean
  }
  const flatAll = parts.flatMap((part, i) => runner.trades(part.spec, chosen[i], { flat: true }))
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
    extras: extrasOf(isRun.trades, oosRun.trades, oosm.net),
    parts: parts.map((x, i) => `${x.spec.id} ${JSON.stringify(chosen[i])}`),
    detail: {
      id,
      oosTrades: oosRun.trades.map(compact),
      ...breakdown(oosRun.trades),
      monthly: monthly(oosRun.trades, span.split, span.to),
      costs: { r0: sigR(0), r1: sigR(1), r2: sigR(2) },
      flatCostNet: portfolioBacktest(START_MONEY, splitTrades(flatAll, span).oos).end - START_MONEY,
      curve: oosRun.curve.map((x) => Math.round(x * 100) / 100),
      neighbours: [],
    },
  }
}
