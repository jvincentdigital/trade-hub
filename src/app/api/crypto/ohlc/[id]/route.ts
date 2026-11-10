import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { ohlcResponseSchema } from '@/lib/schemas'
import { isCoinGeckoId } from '@/lib/coingecko'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'

const ALLOWED_DAYS = new Set([1, 7, 14, 30, 90, 180, 365])

// Last good answer per coin and range. CoinGecko's free tier refuses bursts
// (429); serving the last good candles beats an empty chart.
type Candle = { time: number; open: number; high: number; low: number; close: number }
const lastGood = new Map<string, Candle[]>()

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limit = checkRateLimit('data', getClientIdentifier(request))
  if (!limit.ok) return rateLimitResponse(limit)

  const { id } = await params
  if (!isCoinGeckoId(id)) {
    return NextResponse.json({ error: 'Unknown coin id' }, { status: 400 })
  }

  const url = new URL(request.url)
  const daysRaw = url.searchParams.get('days')
  const days = daysRaw ? Number(daysRaw) : 14
  if (!Number.isFinite(days) || !ALLOWED_DAYS.has(days)) {
    return NextResponse.json(
      { error: `Invalid days (expected one of ${[...ALLOWED_DAYS].join(', ')})` },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`,
      { next: { revalidate: 300 } },
    )
    if (!res.ok) throw new Error(`CoinGecko OHLC ${res.status}`)
    const raw = await res.json()
    const parsed = ohlcResponseSchema.safeParse(raw)
    if (!parsed.success) {
      logger.error({ id, issues: parsed.error.issues }, '[api/crypto/ohlc] schema mismatch')
      return NextResponse.json({ error: 'Invalid upstream response' }, { status: 502 })
    }
    const candles = parsed.data.map((c) => ({
      time: Math.floor(c[0] / 1000),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
    }))
    lastGood.set(`${id}:${days}`, candles)
    return NextResponse.json(candles)
  } catch (err) {
    const stale = lastGood.get(`${id}:${days}`)
    if (stale) return NextResponse.json(stale, { headers: { 'x-stale': '1' } })
    logger.error({ id, err }, '[api/crypto/ohlc] fetch failed')
    return NextResponse.json({ error: 'Failed to fetch OHLC' }, { status: 500 })
  }
}
