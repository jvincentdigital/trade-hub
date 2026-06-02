import { NextResponse } from 'next/server'
import { OHLCCandle } from '@/lib/types/market'
import { detectPatterns } from '@/lib/patterns/detector'
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from '@/lib/rateLimit'
import {
  COIN_MAP,
  fetchOHLC,
  fetchVolumes,
  daysForTimeframe,
  daysForHigherTimeframe,
  type Timeframe,
  type VolumePoint,
} from '@/lib/coingecko'
import {
  scoreSetup,
  getDirection,
  checkInvalidation,
  sessionInfo,
  type ChecklistItems,
  type Direction,
  type Grade,
} from '@/lib/scanner/mmConfluence'

export interface ScannerPattern {
  name: string
  type: 'bullish' | 'bearish' | 'neutral'
  confidence: number
}

export interface ScannerSetup {
  id: string
  symbol: string
  name: string
  assetType: 'crypto' | 'forex'
  timeframe: Timeframe
  direction: Direction
  grade: Grade
  score: number
  price: number
  rsi: number
  pattern: ScannerPattern | null
  checklist: ChecklistItems
  invalidation: string | null
  sessionLabel: string
  sessionValid: boolean
  updatedAt: number
}

export interface ScannerSkip {
  id: string
  reason: string
}

export interface ScannerResponse {
  results: ScannerSetup[]
  skipped: ScannerSkip[]
  timeframe: Timeframe
}

const FOREX_RE = /^[A-Z]{3}-[A-Z]{3}$/

function isTimeframe(x: string): x is Timeframe {
  return x === '30min' || x === '4H' || x === '1D'
}

function alignVolumes(candles: OHLCCandle[], vols: VolumePoint[] | null): number[] | null {
  if (!vols || vols.length === 0) return null
  const sorted = [...vols].sort((a, b) => a.time - b.time)
  return candles.map((c) => {
    let lo = 0
    let hi = sorted.length - 1
    let best = sorted[0].volume
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid].time <= c.time) {
        best = sorted[mid].volume
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return best
  })
}

type BuildOutcome = { ok: true; setup: ScannerSetup } | { ok: false; reason: string }

async function buildSetup(id: string, tf: Timeframe): Promise<BuildOutcome> {
  const meta = COIN_MAP[id]
  if (!meta) return { ok: false, reason: 'unknown-symbol' }

  const [candles, higherCandles, vols] = await Promise.all([
    fetchOHLC(id, daysForTimeframe(tf)),
    fetchOHLC(id, daysForHigherTimeframe(tf)),
    fetchVolumes(id, daysForTimeframe(tf)),
  ])

  if (!candles || candles.length < 20) return { ok: false, reason: 'no-candles' }
  if (!higherCandles || higherCandles.length < 50) return { ok: false, reason: 'no-higher-tf' }

  const direction = getDirection(higherCandles)
  if (!direction) return { ok: false, reason: 'no-bias' }

  const patterns = detectPatterns(candles)
  const volumes = alignVolumes(candles, vols)

  const score = scoreSetup({
    direction,
    isCrypto: true,
    candles,
    higherCandles,
    volumes,
    patterns,
  })

  const invalidation = checkInvalidation({ direction, candles, pattern: score.pattern })
  const session = sessionInfo(true)

  const setup: ScannerSetup = {
    id,
    symbol: meta.symbol,
    name: meta.name,
    assetType: 'crypto',
    timeframe: tf,
    direction,
    grade: score.grade,
    score: score.score,
    price: candles[candles.length - 1].close,
    rsi: Number.isFinite(score.rsiValue) ? score.rsiValue : 0,
    pattern: score.pattern
      ? { name: score.pattern.name, type: score.pattern.type, confidence: score.pattern.confidence }
      : null,
    checklist: score.checklist,
    invalidation,
    sessionLabel: session.label,
    sessionValid: session.valid,
    updatedAt: Date.now(),
  }
  return { ok: true, setup }
}

export async function GET(request: Request) {
  const limit = checkRateLimit('scanner', getClientIdentifier(request))
  if (!limit.ok) return rateLimitResponse(limit)

  const url = new URL(request.url)
  const tfRaw = url.searchParams.get('tf') ?? '4H'
  const symbolsRaw = url.searchParams.get('symbols') ?? ''

  if (!isTimeframe(tfRaw)) {
    return NextResponse.json({ error: 'Invalid tf (expected 30min|4H|1D)' }, { status: 400 })
  }

  const ids = symbolsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const results: ScannerSetup[] = []
  const skipped: ScannerSkip[] = []

  await Promise.all(
    ids.map(async (id) => {
      if (FOREX_RE.test(id)) {
        skipped.push({ id, reason: 'forex-no-ohlc' })
        return
      }
      const out = await buildSetup(id, tfRaw)
      if (out.ok) results.push(out.setup)
      else skipped.push({ id, reason: out.reason })
    }),
  )

  results.sort((a, b) => b.score - a.score)
  const body: ScannerResponse = { results, skipped, timeframe: tfRaw }
  return NextResponse.json(body)
}
