'use client'
import useSWR from 'swr'
import { OHLCCandle } from '../types/market'
import { COIN_MAP, METAL_MAP } from '../coingecko'
import { FOREX_PAIRS } from '../forexPairs'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

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

export function transformForexRates(data: Record<string, number> | undefined): ForexPair[] {
  if (!data) return []
  return FOREX_PAIRS.map((pair) => {
    const rate = pair.invert ? 1 / (data[pair.base] ?? 1) : (data[pair.quote] ?? 1)
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

const okFetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

/**
 * Recent candles for a small chart: 1h from Kraken for crypto and gold (last
 * 48), daily for forex (last 40). SWR shares one fetch per market.
 */
export function useRecentCandles(market: string, isForex: boolean) {
  const url = isForex ? `/api/forex/ohlc/${market}?days=90` : `/api/crypto/candles/${market}?tf=1h`
  const { data, error, isLoading } = useSWR<OHLCCandle[]>(url, okFetcher, {
    refreshInterval: 300000,
    revalidateOnFocus: false,
  })
  const n = isForex ? 40 : 48
  return { candles: Array.isArray(data) ? data.slice(-n) : [], error, isLoading }
}
