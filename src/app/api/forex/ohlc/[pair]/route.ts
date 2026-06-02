import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { frankfurterResponseSchema } from '@/lib/schemas'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'

const ALLOWED_DAYS = new Set([7, 14, 30, 90, 180, 365])
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

  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - days)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const upstream = `https://api.frankfurter.dev/v1/${fmt(start)}..${fmt(end)}?base=${base}&symbols=${quote}`

  try {
    const res = await fetch(upstream, { next: { revalidate: 3600 } })
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
    const raw = await res.json()
    const parsed = frankfurterResponseSchema.safeParse(raw)
    if (!parsed.success) {
      logger.error({ pair, issues: parsed.error.issues }, '[api/forex/ohlc] schema mismatch')
      return NextResponse.json({ error: 'Invalid upstream response' }, { status: 502 })
    }
    const rates = parsed.data.rates
    const dates = Object.keys(rates).sort()
    const candles = dates.map((d, i) => {
      const close = rates[d][quote]
      const open = i > 0 ? rates[dates[i - 1]][quote] : close
      // Frankfurter is daily ECB close; synthesize intraday range at ±0.1%.
      const high = Math.max(open, close) * 1.001
      const low = Math.min(open, close) * 0.999
      return {
        time: Math.floor(new Date(d).getTime() / 1000),
        open,
        high,
        low,
        close,
      }
    })
    return NextResponse.json(candles)
  } catch (err) {
    logger.error({ pair, err }, '[api/forex/ohlc] fetch failed')
    return NextResponse.json({ error: 'Failed to fetch forex OHLC' }, { status: 500 })
  }
}
