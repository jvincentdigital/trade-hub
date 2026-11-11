import { NextResponse } from 'next/server'
import { isCoinGeckoId } from '@/lib/coingecko'
import { CANDLE_TF_HOURS, type CandleTf } from '@/lib/kraken'
import { hasIntraday } from '@/lib/feeds'
import { fetchMarketCandles } from '@/lib/race/feeds'
import { logger } from '@/lib/logger'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'

// Real 15m / 1h / 4h / 1d candles from Kraken's free public OHLC (720 each:
// 7.5 days of 15m, 30 days of 1h, 120 days of 4h, about 2 years of 1d) for
// coins, gold and the forex pairs Kraken trades; GBP/JPY is computed
// (src/lib/feeds.ts). Feeds the strategy rules engine, Today's charts and the race.
function isTf(x: string): x is CandleTf {
  return x in CANDLE_TF_HOURS
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limit = checkRateLimit('data', getClientIdentifier(request))
  if (!limit.ok) return rateLimitResponse(limit)

  const { id } = await params
  if (!isCoinGeckoId(id) && !hasIntraday(id)) {
    return NextResponse.json({ error: 'Unknown market id' }, { status: 400 })
  }
  const tf = new URL(request.url).searchParams.get('tf') ?? '4h'
  if (!isTf(tf)) {
    return NextResponse.json({ error: 'Invalid tf (expected 15m|1h|4h|1d)' }, { status: 400 })
  }
  try {
    return NextResponse.json(await fetchMarketCandles(id, tf))
  } catch (err) {
    logger.error({ id, tf, err }, '[api/crypto/candles] kraken failed')
    return NextResponse.json({ error: 'Failed to fetch candles' }, { status: 502 })
  }
}
