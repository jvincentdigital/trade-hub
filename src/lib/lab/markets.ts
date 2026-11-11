// Strategy lab: the markets, their history and what a trade costs there.
// Prices in the history files are BID (Dukascopy) or last trade (Binance),
// so the lab adds the spread itself (docs/strategy-lab.md, "Costs").

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
}

const ALL: LabTf[] = ['5m', '15m', '30m', '1h', '4h', '1d']
const HOURLY_UP: LabTf[] = ['1h', '4h', '1d']

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
