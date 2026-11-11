// Strategy lab: the markets, their history and what a trade costs there.
// Prices in the history files are BID (Dukascopy) or last trade (Binance),
// so the lab adds the spread itself (docs/strategy-lab.md, "Costs").

import { inWindow, overlapsWindow, type Window } from './news'
import { dayStart, DAY, HOUR, nyOffset, utcHour, utcWeekday } from './time'

export const LAB_TFS = ['5m', '15m', '30m', '1h', '4h', '1d'] as const
export type LabTf = (typeof LAB_TFS)[number]

export const TF_SEC: Record<LabTf, number> = {
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14_400,
  '1d': 86_400,
}

export const TF_WORDS: Record<LabTf, string> = {
  '5m': '5-minute',
  '15m': '15-minute',
  '30m': '30-minute',
  '1h': '1-hour',
  '4h': '4-hour',
  '1d': 'daily',
}

export type LabMarketId = 'GBPUSD' | 'EURUSD' | 'EURGBP' | 'USDJPY' | 'XAUUSD' | 'US30' | 'BTCUSDT'

export interface LabMarket {
  id: LabMarketId
  label: string
  kind: 'forex' | 'gold' | 'index' | 'crypto'
  /** Currencies whose high-impact news can move it (the news filter). */
  currencies: string[]
  /** Bid-ask spread, in price units (a fraction of the price when `pct`). */
  spread: number
  /** Extra cost on every market fill (entry at the open, stop, time exit). Limit fills (planned entries, targets) have none. */
  slippage: number
  pct?: boolean
  /** Commission per side, as a fraction of the position value. */
  fee: number
  /** Position value at most balance x leverage (the race's caps; US30 like gold). */
  leverage: number
  /** Timeframes with at least 12 months of history (the rest only has days). */
  tfs: LabTf[]
  /** Overnight financing a year, as a share of the position value, [long, short]; 0 = none charged (never a credit). */
  swap: [number, number]
}

const ALL: LabTf[] = ['5m', '15m', '30m', '1h', '4h', '1d']
const HOURLY_UP: LabTf[] = ['1h', '4h', '1d']

// Swap (overnight financing): rough typical retail costs a year on the
// position value, [long, short], from each pair's interest-rate gap plus a
// broker markup (USD/JPY shorts and gold and US30 longs pay the most). A side
// that would earn carry is charged 0, never credited.
// Spreads: typical retail numbers (README in the history folder and the
// task's guide). Commission: an ECN-style $3.50 per lot per side on forex,
// about $4 per 100 oz lot on gold, none on US30 (spread only). The race's own
// fee rates (0.007% forex, 0.02% gold) assume no spread, so they are not used
// here on top of a spread; crypto keeps the race's 0.1% taker fee.
export const LAB_MARKETS: LabMarket[] = [
  {
    id: 'GBPUSD',
    label: 'GBP/USD',
    kind: 'forex',
    currencies: ['GBP', 'USD'],
    spread: 0.0001,
    slippage: 0.00002,
    fee: 0.000025,
    leverage: 30,
    tfs: ALL,
    swap: [0.01, 0.01],
  },
  {
    id: 'EURUSD',
    label: 'EUR/USD',
    kind: 'forex',
    currencies: ['EUR', 'USD'],
    spread: 0.00008,
    slippage: 0.00002,
    fee: 0.000025,
    leverage: 30,
    tfs: HOURLY_UP,
    swap: [0.025, 0.005],
  },
  {
    id: 'EURGBP',
    label: 'EUR/GBP',
    kind: 'forex',
    currencies: ['EUR', 'GBP'],
    spread: 0.00012,
    slippage: 0.00002,
    fee: 0.000025,
    leverage: 30,
    tfs: HOURLY_UP,
    swap: [0.025, 0.005],
  },
  {
    id: 'USDJPY',
    label: 'USD/JPY',
    kind: 'forex',
    currencies: ['USD', 'JPY'],
    spread: 0.01,
    slippage: 0.002,
    fee: 0.000025,
    leverage: 30,
    tfs: HOURLY_UP,
    swap: [0.005, 0.045],
  },
  {
    id: 'XAUUSD',
    label: 'Gold',
    kind: 'gold',
    currencies: ['USD'],
    spread: 0.3,
    slippage: 0.05,
    fee: 0.00001,
    leverage: 20,
    tfs: ALL,
    swap: [0.05, 0.01],
  },
  {
    id: 'US30',
    label: 'US30 (Dow)',
    kind: 'index',
    currencies: ['USD'],
    spread: 2,
    slippage: 0.5,
    fee: 0,
    leverage: 20,
    tfs: HOURLY_UP,
    swap: [0.06, 0.01],
  },
  {
    id: 'BTCUSDT',
    label: 'Bitcoin',
    kind: 'crypto',
    currencies: ['USD'],
    spread: 0.0002,
    slippage: 0.0001,
    pct: true,
    fee: 0.001,
    leverage: 1,
    tfs: ALL,
    swap: [0, 0],
  },
]

const BY_ID = new Map(LAB_MARKETS.map((m) => [m.id, m]))

export function labMarket(id: LabMarketId): LabMarket {
  const m = BY_ID.get(id)
  if (!m) throw new Error(`unknown lab market ${id}`)
  return m
}

/** Markets with enough history on this timeframe. */
export const marketsFor = (tf: LabTf): LabMarketId[] =>
  LAB_MARKETS.filter((m) => m.tfs.includes(tf)).map((m) => m.id)

/** Spread in price units at this price, times the cost multiplier. */
export const spreadAt = (m: LabMarket, price: number, mult = 1) =>
  (m.pct ? m.spread * price : m.spread) * mult

export const slippageAt = (m: LabMarket, price: number, mult = 1) =>
  (m.pct ? m.slippage * price : m.slippage) * mult

/** One forex pip in price units (null for gold, US30 and Bitcoin). */
export const pipOf = (m: LabMarket) =>
  m.kind !== 'forex' ? null : m.id.endsWith('JPY') ? 0.01 : 0.0001

// ── Cost model by time (docs/strategy-lab.md, "Costs") ─────────────────────

export interface CostMult {
  spread: number
  slippage: number
}
const ONE: CostMult = { spread: 1, slippage: 1 }
const bump = (a: CostMult, spread: number, slippage = 1): CostMult => ({
  spread: Math.max(a.spread, spread),
  slippage: Math.max(a.slippage, slippage),
})

/** Rollover (21:00-23:00 UTC): spread x4, slippage x2. */
export const ROLLOVER_X = 4
/** First candle after a gap (Sunday reopen, the daily gold and US30 halt): spread x8, slippage x5. */
export const REOPEN_X = 8
/** A candle with red news in it (5 min before to 15 min after): spread x3, slippage x5. */
export const NEWS_X = 3

/**
 * How much wider than normal the spread and slippage are, for a fill at the
 * instant `t` (span 0) or anywhere in [t, t + span) (a candle, for stops and
 * targets). Bitcoin (24/7 exchange) has none. Candles longer than an hour use
 * only what holds at their open: a 4-hour candle is not 4 hours of rollover.
 */
export function costMultAt(
  m: LabMarket,
  t: number,
  span: number,
  afterGap: boolean,
  spikes: Window[],
): CostMult {
  if (m.kind === 'crypto') return ONE
  const s = span > HOUR ? 0 : span
  let c = ONE
  if (afterGap) c = bump(c, REOPEN_X, 5)
  const h0 = utcHour(t)
  const h1 = h0 + s / HOUR
  const hits = (a: number, b: number) => h0 < b && (s ? h1 > a : h0 >= a)
  if (hits(21, 23)) c = bump(c, ROLLOVER_X, 2)
  if (m.kind !== 'index' && (hits(23, 24) || hits(0, 1))) c = bump(c, 1.5)
  if (m.kind === 'index') {
    // Outside the New York cash session (09:30-16:00 New York): x2.5.
    const off = nyOffset(t)
    const open = 9.5 - off
    const close = 16 - off
    const cash = utcWeekday(t) !== 0 && utcWeekday(t) !== 6 && h0 >= open && h1 <= close + 1e-9
    if (!cash) c = bump(c, 2.5)
  }
  if (spikes.length && (s ? overlapsWindow(spikes, t, t + s) : inWindow(spikes, t)))
    c = bump(c, NEWS_X, 5)
  return c
}

/**
 * Overnight financing for a trade held from `entry` to `exit` (unix s), in
 * price units per unit held: one charge per weekday rollover at 22:00 UTC
 * that it is open over, Wednesday counting 3 (forex and gold) or Friday 3
 * (US30) for the weekend, at the market's yearly rate on `price`.
 */
export function swapCost(m: LabMarket, long: boolean, entry: number, exit: number, price: number) {
  const rate = m.swap[long ? 0 : 1]
  if (!(rate > 0) || exit <= entry) return { cost: 0, nights: 0 }
  let nights = 0
  for (let r = dayStart(entry) + 22 * HOUR; r < exit; r += DAY) {
    if (r <= entry) continue
    const wd = utcWeekday(r)
    if (wd === 0 || wd === 6) continue
    nights += wd === (m.kind === 'index' ? 5 : 3) ? 3 : 1
  }
  return { cost: (price * rate * nights) / 365, nights }
}
