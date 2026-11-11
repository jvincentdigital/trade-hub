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
  // Forex with real intraday candles (docs/london-open.md). Checked 2026-11-10:
  // these have tight books and thousands of trades a day. Not here: USD/JPY
  // (Kraken's yen book was bid 157.36 / ask 161.50, trades bounce between the
  // two) and NZD/USD (no pair); those stay on the ECB's daily rates.
  'GBP-USD': 'GBPUSD',
  'EUR-USD': 'EURUSD',
  'EUR-GBP': 'EURGBP',
  'USD-CAD': 'USDCAD',
  'USD-CHF': 'USDCHF',
  'AUD-USD': 'AUDUSD',
}

export type CandleTf = '15m' | '1h' | '4h' | '1d'
export const CANDLE_TF_HOURS: Record<CandleTf, number> = { '15m': 0.25, '1h': 1, '4h': 4, '1d': 24 }
/** 720 candles each: 7.5 days of 15m, 30 days of 1h, 120 days of 4h, about 2 years of 1d. */
export const KRAKEN_INTERVAL: Record<CandleTf, number> = {
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
}

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

/**
 * Kraken's forex books are thin: now and then one trade prints far from the
 * market (AUD/USD 15m candle at 00:45 UTC on 2026-11-11: open 0.68733, high
 * 0.7977, close 0.68772). Those fake wicks hit stops and blow up ranges. Each
 * wick beyond the candle body is capped at max(0.3%, 10x the series' median
 * high-low range, both relative to price). Forex only: crypto and gold keep
 * their real wicks. Pure, tested.
 */
export function capSpikes(candles: OHLCCandle[]): OHLCCandle[] {
  if (!candles.length) return candles
  const rel = candles.map((c) => (c.high - c.low) / c.close).sort((a, b) => a - b)
  const cap = Math.max(0.003, 10 * rel[Math.floor(rel.length / 2)])
  return candles.map((c) => {
    const top = Math.max(c.open, c.close) * (1 + cap)
    const bottom = Math.min(c.open, c.close) * (1 - cap)
    if (c.high <= top && c.low >= bottom) return c
    return { ...c, high: Math.min(c.high, top), low: Math.max(c.low, bottom) }
  })
}

/** Forex ids look like GBP-USD; coins and gold do not. */
const isForex = (id: string) => /^[A-Z]{3}-[A-Z]{3}$/.test(id)

// Kraken's public limit is about one call per second: every call waits its
// turn, results are cached per pair + interval, and a failure is retried once.
const GAP_MS = 1100
const CACHE_MS = 5 * 60_000
const cache = new Map<string, { at: number; candles: Promise<OHLCCandle[]> }>()
let queue: Promise<unknown> = Promise.resolve()
let lastCall = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Forget cached candles, so the next fetch is fresh (Claude's picks, before it opens). */
export function clearKrakenCache() {
  cache.clear()
}

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

/** Real candles for a coin, gold or a forex pair in KRAKEN_PAIRS (forex wicks capped, see capSpikes). The last one is still forming. */
export function fetchKrakenCandles(id: string, tf: CandleTf): Promise<OHLCCandle[]> {
  const pair = KRAKEN_PAIRS[id]
  if (!pair) return Promise.reject(new Error(`No Kraken pair for ${id}`))
  const key = `${pair}:${tf}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.candles
  const interval = KRAKEN_INTERVAL[tf]
  const candles = spaced(() => getOnce(pair, interval))
    .catch(async () => {
      await sleep(2000)
      return spaced(() => getOnce(pair, interval))
    })
    .then((c) => (isForex(id) ? capSpikes(c) : c))
  cache.set(key, { at: Date.now(), candles })
  candles.catch(() => cache.delete(key))
  return candles
}
