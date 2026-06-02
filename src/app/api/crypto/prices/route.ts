import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { cryptoPricesResponseSchema } from '@/lib/schemas'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'

const COINS =
  'bitcoin,ethereum,solana,ripple,binancecoin,cardano,avalanche-2,dogecoin,polkadot,matic-network'

export async function GET(request: Request) {
  const limit = checkRateLimit('data', getClientIdentifier(request))
  if (!limit.ok) return rateLimitResponse(limit)

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${COINS}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
      { next: { revalidate: 60 } },
    )
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
    const raw = await res.json()
    const parsed = cryptoPricesResponseSchema.safeParse(raw)
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, '[api/crypto/prices] schema mismatch')
      return NextResponse.json({ error: 'Invalid upstream response' }, { status: 502 })
    }
    return NextResponse.json(parsed.data)
  } catch (err) {
    logger.error({ err }, '[api/crypto/prices] fetch failed')
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 })
  }
}
