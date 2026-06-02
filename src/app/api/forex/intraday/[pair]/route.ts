import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { twelveDataResponseSchema } from '@/lib/schemas'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'

// Twelve Data free tier: 800 req/day, 8 req/min. Supports intraday forex OHLC.
// Free API key: https://twelvedata.com/register
const ALLOWED_INTERVALS = new Set(['15min', '30min', '1h'] as const)
type Interval = '15min' | '30min' | '1h'

function isInterval(x: string): x is Interval {
  return (ALLOWED_INTERVALS as Set<string>).has(x)
}

const PAIR_RE = /^([A-Z]{3})-([A-Z]{3})$/

// Twelve Data datetimes arrive as "YYYY-MM-DD HH:MM:SS" in the requested
// timezone (we pass timezone=UTC below). Convert to unix seconds.
function toUnixSec(datetime: string): number {
  const iso = datetime.replace(' ', 'T') + 'Z'
  return Math.floor(new Date(iso).getTime() / 1000)
}

export async function GET(request: Request, { params }: { params: Promise<{ pair: string }> }) {
  const limit = checkRateLimit('data', getClientIdentifier(request))
  if (!limit.ok) return rateLimitResponse(limit)

  const apiKey = process.env.TWELVE_DATA_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'Forex intraday is not configured. Set TWELVE_DATA_API_KEY in the environment (free key at twelvedata.com).',
      },
      { status: 503 },
    )
  }

  const { pair } = await params
  const match = PAIR_RE.exec(pair)
  if (!match) {
    return NextResponse.json({ error: 'Invalid pair (expected AAA-BBB)' }, { status: 400 })
  }
  const [, base, quote] = match

  const url = new URL(request.url)
  const intervalRaw = url.searchParams.get('interval') ?? '15min'
  if (!isInterval(intervalRaw)) {
    return NextResponse.json(
      { error: `Invalid interval (expected ${[...ALLOWED_INTERVALS].join('|')})` },
      { status: 400 },
    )
  }

  const upstream =
    `https://api.twelvedata.com/time_series` +
    `?symbol=${base}/${quote}` +
    `&interval=${intervalRaw}` +
    `&outputsize=200` +
    `&timezone=UTC` +
    `&apikey=${apiKey}`

  try {
    const res = await fetch(upstream, { next: { revalidate: 300 } })
    if (!res.ok) throw new Error(`TwelveData ${res.status}`)
    const raw = await res.json()
    const parsed = twelveDataResponseSchema.safeParse(raw)
    if (!parsed.success) {
      logger.error({ pair, issues: parsed.error.issues }, '[api/forex/intraday] schema mismatch')
      return NextResponse.json({ error: 'Invalid upstream response' }, { status: 502 })
    }
    if (parsed.data.status === 'error') {
      logger.error(
        { pair, message: parsed.data.message, code: parsed.data.code },
        '[api/forex/intraday] upstream error',
      )
      return NextResponse.json({ error: `Upstream: ${parsed.data.message}` }, { status: 502 })
    }

    // Twelve Data returns values newest-first; flip to chronological.
    const candles = parsed.data.values
      .map((v) => ({
        time: toUnixSec(v.datetime),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
      }))
      .filter(
        (c) =>
          Number.isFinite(c.time) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close),
      )
      .sort((a, b) => a.time - b.time)

    return NextResponse.json(candles)
  } catch (err) {
    logger.error({ pair, interval: intervalRaw, err }, '[api/forex/intraday] fetch failed')
    return NextResponse.json({ error: 'Failed to fetch forex intraday' }, { status: 500 })
  }
}
