import { frankfurterToCandles, frankfurterUrl } from '../frankfurter'
import { CROSSES, crossCandles, feedOf } from '../feeds'
import { fetchKrakenCandles, type CandleTf } from '../kraken'
import { frankfurterResponseSchema } from '../schemas'
import type { OHLCCandle } from '../types/market'

// Direct upstream fetches for the race scripts and our candle route (no /api
// hop). Where each market comes from: src/lib/feeds.ts.

/** Daily forex candles from Frankfurter (ECB), published days only. */
export async function fetchForexDaily(pair: string, days = 365): Promise<OHLCCandle[]> {
  const [base, quote] = pair.split('-')
  const res = await fetch(frankfurterUrl(base, quote, days))
  if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
  const parsed = frankfurterResponseSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('Frankfurter schema mismatch')
  return frankfurterToCandles(parsed.data.rates, quote)
}

/**
 * Candles of one size for any market. Kraken markets: real candles. Crosses
 * (GBP/JPY): computed, see CROSSES. ECB-only forex: always daily, whatever
 * size is asked (the caller should treat them as daily).
 */
export async function fetchMarketCandles(id: string, tf: CandleTf): Promise<OHLCCandle[]> {
  const feed = feedOf(id)
  if (feed === 'kraken') return fetchKrakenCandles(id, tf)
  if (feed === 'ecb') return fetchForexDaily(id)
  const x = CROSSES[id]
  const a = await fetchKrakenCandles(x.a, tf)
  return crossCandles(a, await dailyLeg(x.b), x.lagSec)
}

// The daily leg of a cross is fetched once per 10 minutes, not once per candle size.
const legs = new Map<string, { at: number; candles: Promise<OHLCCandle[]> }>()
function dailyLeg(pair: string): Promise<OHLCCandle[]> {
  const hit = legs.get(pair)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.candles
  const candles = fetchForexDaily(pair, 730)
  legs.set(pair, { at: Date.now(), candles })
  candles.catch(() => legs.delete(pair))
  return candles
}
