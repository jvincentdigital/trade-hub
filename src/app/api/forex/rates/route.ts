import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { forexRatesResponseSchema } from '@/lib/schemas'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'

export async function GET(request: Request) {
  const limit = checkRateLimit('data', getClientIdentifier(request))
  if (!limit.ok) return rateLimitResponse(limit)

  try {
    // ECB rates via Frankfurter, the source the race opens and closes forex on.
    // (ExchangeRate API rounds to 2-3 digits: CAD 1.41 against the ECB's 1.4136.)
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD', {
      next: { revalidate: 3600 },
    })
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`)
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
