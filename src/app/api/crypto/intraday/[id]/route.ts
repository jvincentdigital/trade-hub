import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { marketChartResponseSchema } from '@/lib/schemas'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'

// CoinGecko free tier: /market_chart?days=1 → 5-minute price points (~289).
// We bucket those into 15- or 30-minute OHLC. Larger intervals aren't worth
// exposing because /market_chart above days=1 drops to 1-point-per-hour,
// which can't produce meaningful OHLC.
const INTERVAL_MINUTES = { '15m': 15, '30m': 30 } as const
type Interval = keyof typeof INTERVAL_MINUTES

function isInterval(x: string): x is Interval {
  return x in INTERVAL_MINUTES
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limit = checkRateLimit('data', getClientIdentifier(request))
  if (!limit.ok) return rateLimitResponse(limit)

  const { id } = await params
  const url = new URL(request.url)
  const intervalRaw = url.searchParams.get('interval') ?? '15m'
  if (!isInterval(intervalRaw)) {
    return NextResponse.json(
      { error: `Invalid interval (expected ${Object.keys(INTERVAL_MINUTES).join('|')})` },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`,
      { next: { revalidate: 300 } },
    )
    if (!res.ok) throw new Error(`CoinGecko market_chart ${res.status}`)
    const raw = await res.json()
    const parsed = marketChartResponseSchema.safeParse(raw)
    if (!parsed.success || !parsed.data.prices) {
      logger.error({ id, interval: intervalRaw }, '[api/crypto/intraday] missing prices')
      return NextResponse.json({ error: 'Invalid upstream response' }, { status: 502 })
    }

    const bucketMs = INTERVAL_MINUTES[intervalRaw] * 60 * 1000
    const buckets = new Map<number, number[]>()
    for (const [t, p] of parsed.data.prices) {
      if (!Number.isFinite(t) || !Number.isFinite(p)) continue
      const key = Math.floor(t / bucketMs) * bucketMs
      const arr = buckets.get(key) ?? []
      arr.push(p)
      buckets.set(key, arr)
    }

    const candles = [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([t, prices]) => ({
        time: Math.floor(t / 1000),
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
      }))

    return NextResponse.json(candles)
  } catch (err) {
    logger.error({ id, interval: intervalRaw, err }, '[api/crypto/intraday] fetch failed')
    return NextResponse.json({ error: 'Failed to fetch intraday' }, { status: 500 })
  }
}
