import { bucketPrices } from '../coingecko'
import { frankfurterToCandles, frankfurterUrl } from '../frankfurter'
import { frankfurterResponseSchema, marketChartResponseSchema } from '../schemas'
import type { OHLCCandle } from '../types/market'

// Direct upstream fetches for the race script (runs outside Next, so it can't
// use our /api routes). Same free, keyless sources and the same candle
// building as those routes.

/** 90 days of 1h candles from CoinGecko hourly prices (the last one is still forming). */
export async function fetchHourlyCandles(id: string): Promise<OHLCCandle[]> {
  const res = await fetch(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=90`,
  )
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
  const parsed = marketChartResponseSchema.safeParse(await res.json())
  if (!parsed.success || !parsed.data.prices) throw new Error('CoinGecko schema mismatch')
  return bucketPrices(parsed.data.prices, 3_600_000)
}

/** Daily forex candles from Frankfurter (ECB), published days only. */
export async function fetchForexDaily(pair: string, days = 365): Promise<OHLCCandle[]> {
  const [base, quote] = pair.split('-')
  const res = await fetch(frankfurterUrl(base, quote, days))
  if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
  const parsed = frankfurterResponseSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('Frankfurter schema mismatch')
  return frankfurterToCandles(parsed.data.rates, quote)
}
