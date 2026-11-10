import { NextResponse } from 'next/server'
import { COIN_MAP, CANDLE_TF_HOURS, fetchCandles, type CandleTf } from '@/lib/coingecko'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'

// 90 days of 1h / 4h / 1d candles built from CoinGecko hourly prices.
// Feeds the strategy rules engine (signals + backtests).
function isTf(x: string): x is CandleTf {
  return x in CANDLE_TF_HOURS
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limit = checkRateLimit('data', getClientIdentifier(request))
  if (!limit.ok) return rateLimitResponse(limit)

  const { id } = await params
  if (!(id in COIN_MAP)) {
    return NextResponse.json({ error: 'Unknown coin id' }, { status: 400 })
  }
  const tf = new URL(request.url).searchParams.get('tf') ?? '4h'
  if (!isTf(tf)) {
    return NextResponse.json({ error: 'Invalid tf (expected 1h|4h|1d)' }, { status: 400 })
  }
  const candles = await fetchCandles(id, tf)
  if (!candles) return NextResponse.json({ error: 'Failed to fetch candles' }, { status: 502 })
  return NextResponse.json(candles)
}
