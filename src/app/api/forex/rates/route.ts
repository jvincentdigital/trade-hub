import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { forexRatesResponseSchema } from '@/lib/schemas'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'

export async function GET(request: Request) {
  const limit = checkRateLimit('data', getClientIdentifier(request))
  if (!limit.ok) return rateLimitResponse(limit)

  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      next: { revalidate: 3600 },
    })
    if (!res.ok) throw new Error(`ExchangeRate ${res.status}`)
    const raw = await res.json()
    const parsed = forexRatesResponseSchema.safeParse(raw)
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, '[api/forex/rates] schema mismatch')
      return NextResponse.json({ error: 'Invalid upstream response' }, { status: 502 })
    }
    return NextResponse.json(parsed.data.rates)
  } catch (err) {
    logger.error({ err }, '[api/forex/rates] fetch failed')
    return NextResponse.json({ error: 'Failed to fetch forex' }, { status: 500 })
  }
}
