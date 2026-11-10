import { frankfurterToCandles, frankfurterUrl } from '../frankfurter'
import { frankfurterResponseSchema } from '../schemas'
import type { OHLCCandle } from '../types/market'

// Direct upstream fetches for the race script (runs outside Next, so it can't
// use our /api routes). Crypto and gold come from lib/kraken directly.

/** Daily forex candles from Frankfurter (ECB), published days only. */
export async function fetchForexDaily(pair: string, days = 365): Promise<OHLCCandle[]> {
  const [base, quote] = pair.split('-')
  const res = await fetch(frankfurterUrl(base, quote, days))
  if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
  const parsed = frankfurterResponseSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('Frankfurter schema mismatch')
  return frankfurterToCandles(parsed.data.rates, quote)
}
