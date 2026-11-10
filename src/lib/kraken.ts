import { z } from 'zod'
import type { OHLCCandle } from './types/market'

// Kraken's free public OHLC endpoint (no key, no account). Real exchange
// candles with true highs and lows, unlike CoinGecko's one price per hour.
//   GET https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=60
// Returns the last 720 candles (plus the one still forming) as
// [time, open, high, low, close, vwap, volume, count], under a result key that
// is Kraken's own pair name (XXBTZUSD for XBTUSD), next to `last`.
// Checked 2026-11-10: every pair below answers, BNBUSD included.

export const KRAKEN_PAIRS: Record<string, string> = {
  bitcoin: 'XBTUSD',
  ethereum: 'ETHUSD',
  solana: 'SOLUSD',
  ripple: 'XRPUSD',
  binancecoin: 'BNBUSD',
  cardano: 'ADAUSD',
  'avalanche-2': 'AVAXUSD',
  dogecoin: 'XDGUSD',
  polkadot: 'DOTUSD',
  'polygon-ecosystem-token': 'POLUSD',
  'pax-gold': 'PAXGUSD', // gold, see docs/gold.md
}

export type CandleTf = '1h' | '4h' | '1d'
export const CANDLE_TF_HOURS: Record<CandleTf, number> = { '1h': 1, '4h': 4, '1d': 24 }
export const KRAKEN_INTERVAL: Record<CandleTf, number> = { '1h': 60, '4h': 240, '1d': 1440 }

const responseSchema = z.object({
  error: z.array(z.string()),
  result: z.record(z.string(), z.unknown()).optional(),
})
const rowSchema = z.tuple([
  z.number(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  z.number(),
])

/** Kraken OHLC JSON to candles, oldest first. Throws on an error or an unexpected shape. */
export function parseKrakenOHLC(json: unknown): OHLCCandle[] {
  const parsed = responseSchema.safeParse(json)
  if (!parsed.success) throw new Error('Kraken schema mismatch')
  if (parsed.data.error.length) throw new Error(`Kraken ${parsed.data.error.join(', ')}`)
  const key = Object.keys(parsed.data.result ?? {}).find((k) => k !== 'last')
  const rows = z.array(rowSchema).safeParse(key ? parsed.data.result?.[key] : undefined)
  if (!rows.success) throw new Error('Kraken schema mismatch')
  return rows.data
    .map(([time, o, h, l, c]) => ({
      time,
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
}

// Kraken's public limit is about one call per second: every call waits its
// turn, results are cached per pair + interval, and a failure is retried once.
const GAP_MS = 1100
const CACHE_MS = 5 * 60_000
const cache = new Map<string, { at: number; candles: Promise<OHLCCandle[]> }>()
let queue: Promise<unknown> = Promise.resolve()
let lastCall = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastCall = Date.now()
    return fn()
  })
  queue = run.catch(() => undefined)
  return run
}

async function getOnce(pair: string, interval: number): Promise<OHLCCandle[]> {
  const res = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}`)
  if (!res.ok) throw new Error(`Kraken ${res.status}`)
  return parseKrakenOHLC(await res.json())
}

/** Real candles for a coin or gold. The last one is still forming. */
export function fetchKrakenCandles(id: string, tf: CandleTf): Promise<OHLCCandle[]> {
  const pair = KRAKEN_PAIRS[id]
  if (!pair) return Promise.reject(new Error(`No Kraken pair for ${id}`))
  const key = `${pair}:${tf}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.candles
  const interval = KRAKEN_INTERVAL[tf]
  const candles = spaced(() => getOnce(pair, interval)).catch(async () => {
    await sleep(2000)
    return spaced(() => getOnce(pair, interval))
  })
  cache.set(key, { at: Date.now(), candles })
  candles.catch(() => cache.delete(key))
  return candles
}
