'use client'
import useSWR from 'swr'
import { OHLCCandle } from '../types/market'
import { COIN_MAP, METAL_MAP } from '../coingecko'
import { FOREX_PAIRS } from '../forexPairs'
import { getInstrument } from '../paper/instruments'
import { hasIntraday } from '../feeds'

// Throws on an error status, so SWR keeps the last good data and retries
// instead of handing the page an `{ error }` body as if it were prices.
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

export type CoinGeckoRow = {
  usd?: number
  usd_24h_change?: number
  usd_24h_vol?: number
  usd_market_cap?: number
}

export interface CryptoPrice {
  id: string
  symbol: string
  name: string
  price: number
  change24h: number
  volume24h: number
  marketCap: number
  type: 'crypto'
}

export interface ForexPair {
  id: string
  symbol: string
  name: string
  price: number
  change24h: number
  type: 'forex'
}

export { FOREX_PAIRS }

export function transformCryptoPrices(
  data: Record<string, CoinGeckoRow> | undefined,
): CryptoPrice[] {
  if (!data) return []
  return Object.entries(COIN_MAP).map(([id, meta]) => ({
    id,
    symbol: meta.symbol,
    name: meta.name,
    price: data[id]?.usd ?? 0,
    change24h: data[id]?.usd_24h_change ?? 0,
    volume24h: data[id]?.usd_24h_vol ?? 0,
    marketCap: data[id]?.usd_market_cap ?? 0,
    type: 'crypto' as const,
  }))
}

/**
 * Pair prices from USD-based rates (1 USD buys data[X] of X): EUR/USD is
 * 1 / data.EUR, USD/JPY is data.JPY, and a cross like EUR/GBP is
 * data.GBP / data.EUR. A missing currency gives 0 (no price).
 */
export function transformForexRates(data: Record<string, number> | undefined): ForexPair[] {
  if (!data) return []
  const perUsd = (c: string) => (c === 'USD' ? 1 : data[c])
  return FOREX_PAIRS.map((pair) => {
    const q = perUsd(pair.quote)
    const b = perUsd(pair.base)
    const rate = q > 0 && b > 0 ? q / b : 0
    return {
      id: pair.symbol.replace('/', '-'),
      symbol: pair.symbol,
      name: pair.symbol,
      price: rate,
      change24h: 0,
      type: 'forex' as const,
    }
  })
}

export function useCryptoPrices() {
  const { data, error, isLoading, mutate } = useSWR<Record<string, CoinGeckoRow>>(
    '/api/crypto/prices',
    fetcher,
    { refreshInterval: 60000 },
  )
  return { prices: transformCryptoPrices(data), error, isLoading, refresh: mutate }
}

/** Gold (PAX Gold) price, from the same cached call as the crypto prices. */
export function transformMetalPrices(data: Record<string, CoinGeckoRow> | undefined) {
  if (!data) return []
  return Object.entries(METAL_MAP).map(([id, meta]) => ({
    id,
    name: meta.name,
    note: meta.note,
    price: data[id]?.usd ?? 0,
    change24h: data[id]?.usd_24h_change ?? 0,
  }))
}

export function useMetalPrices() {
  const { data, error, isLoading } = useSWR<Record<string, CoinGeckoRow>>(
    '/api/crypto/prices',
    fetcher,
    { refreshInterval: 60000 },
  )
  return { metals: transformMetalPrices(data), error, isLoading }
}

export function useCryptoOHLC(id: string) {
  const { data, error, isLoading } = useSWR<OHLCCandle[]>(
    id ? `/api/crypto/ohlc/${id}` : null,
    fetcher,
    { refreshInterval: 300000 },
  )
  return { candles: data ?? [], error, isLoading }
}

export function useForexRates() {
  const { data, error, isLoading, mutate } = useSWR<Record<string, number>>(
    '/api/forex/rates',
    fetcher,
    { refreshInterval: 3600000 },
  )
  return { rates: transformForexRates(data), error, isLoading, refresh: mutate }
}

const candleUrl = (market: string) =>
  getInstrument(market)?.market === 'forex' && !hasIntraday(market)
    ? `/api/forex/ohlc/${market}?days=90`
    : `/api/crypto/candles/${market}?tf=1h`

const NO_CANDLES: Record<string, OHLCCandle[]> = {}

/**
 * Candles for the Today page, one fetch per market: 1h from Kraken for crypto,
 * gold and the forex pairs Kraken trades (30 days; GBP/JPY computed), daily for
 * the other forex (90 days). Feeds the open P&L chart and
 * the chart in an opened trade row. A market whose fetch fails is left out.
 */
export function useCandleMap(markets: string[]) {
  const unique = [...new Set(markets)].sort()
  const { data, isLoading } = useSWR(
    unique.length ? ['candle-map', ...unique] : null,
    async ([, ...ms]: string[]) => {
      const got = await Promise.allSettled(ms.map((m) => fetcher(candleUrl(m))))
      return Object.fromEntries(
        ms.flatMap((m, i) => {
          const r = got[i]
          return r.status === 'fulfilled' && Array.isArray(r.value)
            ? [[m, r.value as OHLCCandle[]]]
            : []
        }),
      )
    },
    { refreshInterval: 300000, revalidateOnFocus: false, keepPreviousData: true },
  )
  return { candles: data ?? NO_CANDLES, isLoading }
}
