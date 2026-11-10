import { OHLCCandle } from './types/market'
import { logger } from './logger'
import { ohlcResponseSchema, marketChartResponseSchema } from './schemas'

export interface CoinMeta {
  name: string
  symbol: string
}

export const COIN_MAP: Record<string, CoinMeta> = {
  bitcoin: { name: 'Bitcoin', symbol: 'BTC' },
  ethereum: { name: 'Ethereum', symbol: 'ETH' },
  solana: { name: 'Solana', symbol: 'SOL' },
  ripple: { name: 'XRP', symbol: 'XRP' },
  binancecoin: { name: 'BNB', symbol: 'BNB' },
  cardano: { name: 'Cardano', symbol: 'ADA' },
  'avalanche-2': { name: 'Avalanche', symbol: 'AVAX' },
  dogecoin: { name: 'Dogecoin', symbol: 'DOGE' },
  polkadot: { name: 'Polkadot', symbol: 'DOT' },
  // MATIC was migrated to POL; CoinGecko's matic-network feed went stale (null 24h change).
  'polygon-ecosystem-token': { name: 'Polygon', symbol: 'POL' },
}

export type Timeframe = '30min' | '4H' | '1D'

// CoinGecko /ohlc granularity is locked to the `days` param (checked 2026-11-10):
//   days=1       → 30-minute candles (~48)
//   days=2..30   → 4-hour candles
//   days=31+     → 4-DAY candles (not daily). Use fetchCandles for real 1d bars.
export async function fetchOHLC(id: string, days: number): Promise<OHLCCandle[] | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`,
      { next: { revalidate: 300 } },
    )
    if (!res.ok) {
      logger.error({ id, status: res.status }, '[coingecko.fetchOHLC] http error')
      return null
    }
    const raw = await res.json()
    const parsed = ohlcResponseSchema.safeParse(raw)
    if (!parsed.success) {
      logger.error({ id, issues: parsed.error.issues }, '[coingecko.fetchOHLC] schema mismatch')
      return null
    }
    return parsed.data.map((c) => ({
      time: Math.floor(c[0] / 1000),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
    }))
  } catch (err) {
    logger.error({ id, err }, '[coingecko.fetchOHLC] fetch failed')
    return null
  }
}

export interface VolumePoint {
  time: number
  volume: number
}

export async function fetchVolumes(id: string, days: number): Promise<VolumePoint[] | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`,
      { next: { revalidate: 300 } },
    )
    if (!res.ok) {
      logger.error({ id, status: res.status }, '[coingecko.fetchVolumes] http error')
      return null
    }
    const raw = await res.json()
    const parsed = marketChartResponseSchema.safeParse(raw)
    if (!parsed.success) {
      logger.error({ id, issues: parsed.error.issues }, '[coingecko.fetchVolumes] schema mismatch')
      return null
    }
    return (parsed.data.total_volumes ?? []).map(([t, v]) => ({
      time: Math.floor(t / 1000),
      volume: v,
    }))
  } catch (err) {
    logger.error({ id, err }, '[coingecko.fetchVolumes] fetch failed')
    return null
  }
}

// ── Hourly-built candles ──────────────────────────────────────────────────
// CoinGecko's free /ohlc returns 4-DAY candles for any range above 30 days,
// so it cannot give real daily bars. /market_chart?days=90 returns one price
// point per hour (~2160), which we bucket into 1h / 4h / 1d candles. High and
// low come from hourly samples, so wicks are slightly understated.
export type CandleTf = '1h' | '4h' | '1d'
export const CANDLE_TF_HOURS: Record<CandleTf, number> = { '1h': 1, '4h': 4, '1d': 24 }

export function bucketPrices(prices: Array<[number, number]>, bucketMs: number): OHLCCandle[] {
  const buckets = new Map<number, number[]>()
  for (const [t, p] of prices) {
    if (!Number.isFinite(t) || !Number.isFinite(p)) continue
    const key = Math.floor(t / bucketMs) * bucketMs
    const arr = buckets.get(key) ?? []
    arr.push(p)
    buckets.set(key, arr)
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, ps]) => ({
      time: Math.floor(t / 1000),
      open: ps[0],
      high: Math.max(...ps),
      low: Math.min(...ps),
      close: ps[ps.length - 1],
    }))
}

export async function fetchCandles(id: string, tf: CandleTf): Promise<OHLCCandle[] | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=90`,
      { next: { revalidate: 300 } },
    )
    if (!res.ok) {
      logger.error({ id, status: res.status }, '[coingecko.fetchCandles] http error')
      return null
    }
    const parsed = marketChartResponseSchema.safeParse(await res.json())
    if (!parsed.success || !parsed.data.prices) {
      logger.error({ id }, '[coingecko.fetchCandles] schema mismatch')
      return null
    }
    return bucketPrices(parsed.data.prices, CANDLE_TF_HOURS[tf] * 3_600_000)
  } catch (err) {
    logger.error({ id, err }, '[coingecko.fetchCandles] fetch failed')
    return null
  }
}
