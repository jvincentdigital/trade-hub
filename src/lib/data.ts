import type { OHLCCandle } from './types/market'

// Client-side OHLC fetchers. Both proxy through our own API routes so we
// get ISR caching + centralized logging + Zod validation at the boundary.

export type CryptoDays = 1 | 7 | 14 | 30 | 90 | 180 | 365
export type ForexDays = 7 | 14 | 30 | 90 | 180 | 365 | 730
export type CryptoIntraday = '15m' | '30m'

export async function fetchCryptoOHLC(id: string, days: CryptoDays): Promise<OHLCCandle[]> {
  const res = await fetch(`/api/crypto/ohlc/${encodeURIComponent(id)}?days=${days}`)
  if (!res.ok) throw new Error(`crypto ohlc ${res.status}`)
  return res.json()
}

export async function fetchCryptoIntraday(
  id: string,
  interval: CryptoIntraday,
): Promise<OHLCCandle[]> {
  const res = await fetch(`/api/crypto/intraday/${encodeURIComponent(id)}?interval=${interval}`)
  if (!res.ok) throw new Error(`crypto intraday ${res.status}`)
  return res.json()
}

export async function fetchForexOHLC(pair: string, days: ForexDays): Promise<OHLCCandle[]> {
  // Accept either "EUR/USD" or "EUR-USD"; the route expects the hyphenated form.
  const slug = pair.replace('/', '-')
  const res = await fetch(`/api/forex/ohlc/${encodeURIComponent(slug)}?days=${days}`)
  if (!res.ok) throw new Error(`forex ohlc ${res.status}`)
  return res.json()
}

export type ForexIntraday = '15min' | '30min' | '1h'

export async function fetchForexIntraday(
  pair: string,
  interval: ForexIntraday,
): Promise<OHLCCandle[]> {
  const slug = pair.replace('/', '-')
  const res = await fetch(`/api/forex/intraday/${encodeURIComponent(slug)}?interval=${interval}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `forex intraday ${res.status}`)
  }
  return res.json()
}

export type CryptoCandleTf = '1h' | '4h' | '1d'

/** Real 1h / 4h / 1d candles from Kraken via our route (see lib/kraken). */
export async function fetchCryptoCandles(id: string, tf: CryptoCandleTf): Promise<OHLCCandle[]> {
  const res = await fetch(`/api/crypto/candles/${encodeURIComponent(id)}?tf=${tf}`)
  if (!res.ok) throw new Error(`crypto candles ${res.status}`)
  return res.json()
}
