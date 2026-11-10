import { OHLCCandle, PatternResult } from '../types/market'

export type Direction = 'long' | 'short'
export type Grade = 'A' | 'B' | 'C'

export interface ChecklistItems {
  mtfAlignment: boolean
  mWFormation: boolean
  ema50Confluence: boolean
  srConfluence: boolean
  rsiExtreme: boolean
  rsiDivergence: boolean
  patternWithVolume: boolean
}

export interface ScoreInput {
  direction: Direction
  isCrypto: boolean
  candles: OHLCCandle[]
  higherCandles: OHLCCandle[]
  volumes: number[] | null
  patterns: PatternResult[]
}

export interface ScoreOutput {
  score: number
  grade: Grade
  checklist: ChecklistItems
  rsiValue: number
  pattern: PatternResult | null
}

export function ema(values: number[], period: number): number[] {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  const out: number[] = []
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out.push(prev)
  for (let i = period; i < values.length; i++) {
    const next = values[i] * k + prev * (1 - k)
    out.push(next)
    prev = next
  }
  return out
}

export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return NaN
  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

export function rsiSeries(closes: number[], period = 14): number[] {
  const out: number[] = []
  if (closes.length < period + 1) return out
  let gains = 0
  let losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return out
}

export function detectMWFormation(candles: OHLCCandle[]): 'W' | 'M' | null {
  const n = candles.length
  if (n < 10) return null
  const window = candles.slice(-10)
  const last = candles[n - 1]

  let low1 = { value: Infinity, i: -1 }
  let low2 = { value: Infinity, i: -1 }
  window.forEach((c, i) => {
    if (c.low < low1.value) {
      low2 = low1
      low1 = { value: c.low, i }
    } else if (c.low < low2.value) {
      low2 = { value: c.low, i }
    }
  })
  if (low1.i >= 0 && low2.i >= 0) {
    const [first, second] = low1.i < low2.i ? [low1, low2] : [low2, low1]
    if (second.value < first.value && last.close > first.value) return 'W'
  }

  let hi1 = { value: -Infinity, i: -1 }
  let hi2 = { value: -Infinity, i: -1 }
  window.forEach((c, i) => {
    if (c.high > hi1.value) {
      hi2 = hi1
      hi1 = { value: c.high, i }
    } else if (c.high > hi2.value) {
      hi2 = { value: c.high, i }
    }
  })
  if (hi1.i >= 0 && hi2.i >= 0) {
    const [first, second] = hi1.i < hi2.i ? [hi1, hi2] : [hi2, hi1]
    if (second.value > first.value && last.close < first.value) return 'M'
  }
  return null
}

function detectDivergence(candles: OHLCCandle[], direction: Direction): boolean {
  const closes = candles.map((c) => c.close)
  const rsis = rsiSeries(closes, 14)
  if (rsis.length < 10) return false
  const rsiOffset = closes.length - rsis.length
  const rsiAt = (idx: number) => rsis[idx - rsiOffset]

  const n = candles.length
  const lookback = Math.min(12, n)
  const startA = n - lookback
  const midA = n - Math.floor(lookback / 2)

  if (direction === 'long') {
    let a = { idx: startA, value: candles[startA].low }
    for (let i = startA + 1; i < midA; i++) {
      if (candles[i].low < a.value) a = { idx: i, value: candles[i].low }
    }
    let b = { idx: midA, value: candles[midA].low }
    for (let i = midA + 1; i < n; i++) {
      if (candles[i].low < b.value) b = { idx: i, value: candles[i].low }
    }
    const ra = rsiAt(a.idx)
    const rb = rsiAt(b.idx)
    if (!Number.isFinite(ra) || !Number.isFinite(rb)) return false
    return b.value < a.value && rb > ra
  }

  let a = { idx: startA, value: candles[startA].high }
  for (let i = startA + 1; i < midA; i++) {
    if (candles[i].high > a.value) a = { idx: i, value: candles[i].high }
  }
  let b = { idx: midA, value: candles[midA].high }
  for (let i = midA + 1; i < n; i++) {
    if (candles[i].high > b.value) b = { idx: i, value: candles[i].high }
  }
  const ra = rsiAt(a.idx)
  const rb = rsiAt(b.idx)
  if (!Number.isFinite(ra) || !Number.isFinite(rb)) return false
  return b.value > a.value && rb < ra
}

export function getDirection(higherCandles: OHLCCandle[]): Direction | null {
  if (higherCandles.length < 50) return null
  const closes = higherCandles.map((c) => c.close)
  const period = closes.length >= 200 ? 200 : 50
  const series = ema(closes, period)
  if (series.length === 0) return null
  const last = closes[closes.length - 1]
  const eLast = series[series.length - 1]
  if (last > eLast * 1.002) return 'long'
  if (last < eLast * 0.998) return 'short'
  return null
}

export function scoreSetup(input: ScoreInput): ScoreOutput {
  const { direction, isCrypto, candles, higherCandles, volumes, patterns } = input
  const closes = candles.map((c) => c.close)
  const n = candles.length
  const last = candles[n - 1]

  let mtfAlignment = false
  if (higherCandles.length >= 50) {
    const hCloses = higherCandles.map((c) => c.close)
    const period = hCloses.length >= 200 ? 200 : 50
    const eSeries = ema(hCloses, period)
    const eLast = eSeries[eSeries.length - 1]
    const hLast = hCloses[hCloses.length - 1]
    mtfAlignment = direction === 'long' ? hLast > eLast : hLast < eLast
  }

  const formation = detectMWFormation(candles)
  const mWFormation =
    (direction === 'long' && formation === 'W') || (direction === 'short' && formation === 'M')

  let ema50Confluence = false
  if (closes.length >= 50) {
    const e = ema(closes, 50)
    const eLast = e[e.length - 1]
    if (eLast > 0) ema50Confluence = Math.abs(last.close - eLast) / eLast <= 0.01
  }

  let srConfluence = false
  if (n >= 20) {
    const last20 = candles.slice(-20)
    if (direction === 'long') {
      const minLow = Math.min(...last20.map((c) => c.low))
      srConfluence = minLow > 0 && Math.abs(last.close - minLow) / minLow <= 0.005
    } else {
      const maxHigh = Math.max(...last20.map((c) => c.high))
      srConfluence = maxHigh > 0 && Math.abs(last.close - maxHigh) / maxHigh <= 0.005
    }
  }

  const rsiValue = rsi(closes, 14)
  const rsiExtreme = Number.isFinite(rsiValue)
    ? direction === 'long'
      ? rsiValue < 35
      : rsiValue > 65
    : false

  const rsiDivergence = detectDivergence(candles, direction)

  const pattern =
    patterns.find((p) => (direction === 'long' ? p.type === 'bullish' : p.type === 'bearish')) ??
    null

  let patternWithVolume = !!pattern
  if (patternWithVolume && isCrypto) {
    if (volumes && volumes.length >= 21) {
      const lastVol = volumes[volumes.length - 1]
      const avg20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20
      patternWithVolume = avg20 > 0 && lastVol >= avg20 * 1.5
    } else {
      patternWithVolume = false
    }
  }

  const checklist: ChecklistItems = {
    mtfAlignment,
    mWFormation,
    ema50Confluence,
    srConfluence,
    rsiExtreme,
    rsiDivergence,
    patternWithVolume,
  }

  const score = Object.values(checklist).filter(Boolean).length
  const grade: Grade = score >= 6 ? 'A' : score >= 4 ? 'B' : 'C'

  return { score, grade, checklist, rsiValue, pattern }
}

export interface InvalidationInput {
  direction: Direction
  candles: OHLCCandle[]
  pattern: PatternResult | null
}

export function checkInvalidation({
  direction,
  candles,
  pattern,
}: InvalidationInput): string | null {
  const n = candles.length
  if (n < 20) return null
  const last = candles[n - 1]
  const last20 = candles.slice(-20)
  const range20 = Math.max(...last20.map((c) => c.high)) - Math.min(...last20.map((c) => c.low))
  const wick =
    direction === 'long'
      ? Math.min(last.open, last.close) - last.low
      : last.high - Math.max(last.open, last.close)
  if (range20 > 0 && wick > range20 * 0.5) return 'Stop-hunt wick too deep — likely real breakout'

  if (!pattern) return null

  const prev = candles[n - 2]
  if (prev) {
    const prevRange = prev.high - prev.low
    const prevBody = Math.abs(prev.close - prev.open)
    const prevOpposite = direction === 'long' ? prev.close < prev.open : prev.close > prev.open
    if (prevOpposite && prevRange > 0 && prevBody / prevRange > 0.7 && prevBody > range20 * 0.25) {
      return 'Large opposite dominant candle right before trigger'
    }
  }

  return null
}

export interface SessionInfo {
  valid: boolean
  label: string
}

export function sessionInfo(isCrypto: boolean, now: Date = new Date()): SessionInfo {
  const hourF = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  })
  const minuteF = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    minute: 'numeric',
  })
  const hour = Number(hourF.format(now))
  const minute = Number(minuteF.format(now))
  const h = (Number.isFinite(hour) ? hour % 24 : 0) + (Number.isFinite(minute) ? minute / 60 : 0)

  if (isCrypto) {
    if ((h >= 8 && h < 12) || (h >= 20 && h < 24)) return { valid: true, label: 'Prime session' }
    return { valid: true, label: 'Off-peak' }
  }
  if (h >= 1 && h < 2.5) return { valid: true, label: 'Pre-London' }
  if (h >= 2.5 && h < 4) return { valid: true, label: 'London open' }
  if (h >= 8 && h < 10) return { valid: true, label: 'NY open' }
  return { valid: false, label: 'Off-session' }
}
