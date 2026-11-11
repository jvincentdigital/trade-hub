import { z } from 'zod'
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

// ── Yahoo Finance public chart feed (US30 for the lab bots) ───────────────
// No key, no account, unofficial: play money only (John chose it, 2026-11-10).
// US30 = Dow futures YM=F (CBOT, trades about 23 hours a day like the lab's
// Dukascopy US30), not the cash index ^DJI (only 09:30-16:00 New York).

export const YAHOO_US30 = 'YM=F'

const yahooSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          timestamp: z.array(z.number()),
          indicators: z.object({
            quote: z
              .array(
                z.object({
                  open: z.array(z.number().nullable()),
                  high: z.array(z.number().nullable()),
                  low: z.array(z.number().nullable()),
                  close: z.array(z.number().nullable()),
                }),
              )
              .min(1),
          }),
        }),
      )
      .min(1),
  }),
})

/**
 * Yahoo chart JSON to candles, oldest first. Rows with a missing price are
 * dropped, and so is a row off the candle grid (Yahoo adds the latest quote
 * as a last row stamped with its own time, like 07:28:13).
 */
export function parseYahooChart(json: unknown, stepSec: number): OHLCCandle[] {
  const p = yahooSchema.safeParse(json)
  if (!p.success) throw new Error('Yahoo chart schema mismatch')
  const r = p.data.chart.result[0]
  const q = r.indicators.quote[0]
  const out: OHLCCandle[] = []
  for (let i = 0; i < r.timestamp.length; i++) {
    const [open, high, low, close] = [q.open[i], q.high[i], q.low[i], q.close[i]]
    const time = r.timestamp[i]
    if (open == null || high == null || low == null || close == null) continue
    if (time % stepSec !== 0) continue
    const prev = out[out.length - 1]
    if (prev && time <= prev.time) continue
    out.push({ time, open, high, low, close })
  }
  return out
}

/** Last 30 days of 1h candles for a Yahoo symbol (the last one still forming). */
export async function fetchYahooHourly(symbol: string): Promise<OHLCCandle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=60m&range=30d`
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (trade-hub race, play money)' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Yahoo ${res.status}`)
  return parseYahooChart(await res.json(), 3600)
}
