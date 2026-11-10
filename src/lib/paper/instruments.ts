import { COIN_MAP } from '../coingecko'
import { FOREX_PAIRS } from '../hooks/useMarketData'

export type Market = 'crypto' | 'forex'

export interface Instrument {
  /** CoinGecko id for crypto (`bitcoin`), hyphenated pair for forex (`EUR-USD`). */
  id: string
  symbol: string
  market: Market
  /** Currency the price is quoted in; P&L is converted from this to USD. */
  quote: string
}

export const INSTRUMENTS: Instrument[] = [
  ...Object.entries(COIN_MAP).map(([id, m]) => ({
    id,
    symbol: `${m.symbol}/USD`,
    market: 'crypto' as const,
    quote: 'USD',
  })),
  ...FOREX_PAIRS.map((p) => ({
    id: p.symbol.replace('/', '-'),
    symbol: p.symbol,
    market: 'forex' as const,
    quote: p.quote,
  })),
]

const BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]))

export function getInstrument(id: string): Instrument | undefined {
  return BY_ID.get(id)
}

/** Latest price per instrument id. */
export type PriceMap = Record<string, number>

/**
 * How many USD one unit of `quote` is worth, derived from the live pair
 * prices we already have. Returns null when the needed pair has no price.
 */
export function quoteToUsd(quote: string, prices: PriceMap): number | null {
  if (quote === 'USD') return 1
  const direct = prices[`${quote}-USD`]
  if (direct && direct > 0) return direct
  const inverse = prices[`USD-${quote}`]
  if (inverse && inverse > 0) return 1 / inverse
  return null
}

/** Price display with sensible decimals per market (forex is not in dollars). */
export function formatQuote(price: number, inst: Instrument | undefined): string {
  if (!Number.isFinite(price)) return '-'
  if (inst?.market === 'forex') return price.toFixed(inst.quote === 'JPY' ? 3 : 5)
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (price >= 1) return price.toFixed(2)
  if (price >= 0.01) return price.toFixed(4)
  return price.toFixed(6)
}
