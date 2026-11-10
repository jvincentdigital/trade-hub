import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { frankfurterResponseSchema } from '@/lib/schemas'
import { frankfurterToCandles, frankfurterUrl } from '@/lib/frankfurter'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'

const ALLOWED_DAYS = new Set([7, 14, 30, 90, 180, 365, 730])
const PAIR_RE = /^([A-Z]{3})-([A-Z]{3})$/

export async function GET(request: Request, { params }: { params: Promise<{ pair: string }> }) {
  const limit = checkRateLimit('data', getClientIdentifier(request))
  if (!limit.ok) return rateLimitResponse(limit)

  const { pair } = await params
  const match = PAIR_RE.exec(pair)
  if (!match) {
    return NextResponse.json({ error: 'Invalid pair (expected AAA-BBB)' }, { status: 400 })
  }
  const [, base, quote] = match

  const url = new URL(request.url)
  const daysRaw = url.searchParams.get('days')
  const days = daysRaw ? Number(daysRaw) : 90
  if (!Number.isFinite(days) || !ALLOWED_DAYS.has(days)) {
    return NextResponse.json(
      { error: `Invalid days (expected one of ${[...ALLOWED_DAYS].join(', ')})` },
      { status: 400 },
    )
  }

  const upstream = frankfurterUrl(base, quote, days)

  try {
    const res = await fetch(upstream, { next: { revalidate: 3600 } })
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
    const raw = await res.json()
    const parsed = frankfurterResponseSchema.safeParse(raw)
    if (!parsed.success) {
      logger.error({ pair, issues: parsed.error.issues }, '[api/forex/ohlc] schema mismatch')
      return NextResponse.json({ error: 'Invalid upstream response' }, { status: 502 })
    }
    const candles = frankfurterToCandles(parsed.data.rates, quote)
    return NextResponse.json(candles)
  } catch (err) {
    logger.error({ pair, err }, '[api/forex/ohlc] fetch failed')
    return NextResponse.json({ error: 'Failed to fetch forex OHLC' }, { status: 500 })
  }
}
