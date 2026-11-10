import { OHLCCandle, PatternHit, PatternResult } from '../types/market'
import * as P from './patterns'

// Exhaustive list of pattern names the engine can emit, plus "Any" for the
// strategy modal's pattern-watch dropdown.
export const PATTERN_NAMES = [
  'Any',
  'Doji',
  'Long-legged Doji',
  'Gravestone Doji',
  'Dragonfly Doji',
  'Hammer',
  'Inverted Hammer',
  'Hanging Man',
  'Shooting Star',
  'Bullish Marubozu',
  'Bearish Marubozu',
  'Spinning Top',
  'Bullish Engulfing',
  'Bearish Engulfing',
  'Bullish Harami',
  'Bearish Harami',
  'Piercing Line',
  'Dark Cloud Cover',
  'Tweezer Top',
  'Tweezer Bottom',
  'Morning Star',
  'Evening Star',
  'Three White Soldiers',
  'Three Black Crows',
] as const

export type PatternName = (typeof PATTERN_NAMES)[number]

// A candle with no range (high === low) has no shape to read. Old hourly-price
// candles were flat like this and every one passed as both a Dragonfly and a
// Gravestone Doji, so flat candles never count, alone or inside a pattern.
const flat = (c: OHLCCandle) => c.high === c.low

// Run every detector at every candle index, returning a flat list of hits
// with index + time for chart markers. O(n × detectors); fine for ≤ 500 candles.
export function detectAll(candles: OHLCCandle[]): PatternHit[] {
  const hits: PatternHit[] = []
  if (!candles || candles.length < 3) return hits
  for (let i = 2; i < candles.length; i++) {
    const c = candles[i]
    const prev1 = candles[i - 1]
    const prev2 = candles[i - 2]
    const history = candles.slice(0, i)
    if (flat(c)) continue

    const singles = [
      P.detectDoji(c),
      P.detectLongLeggedDoji(c),
      P.detectGravestoneDoji(c),
      P.detectDragonflyDoji(c),
      P.detectMarubozu(c),
      P.detectSpinningTop(c),
      P.detectHammer(c, history),
      P.detectHangingMan(c, history),
      P.detectInvertedHammer(c, history),
      P.detectShootingStar(c, history),
    ]
    const doubles = flat(prev1)
      ? []
      : [
          P.detectBullishEngulfing(c, prev1),
          P.detectBearishEngulfing(c, prev1),
          P.detectBullishHarami(c, prev1),
          P.detectBearishHarami(c, prev1),
          P.detectPiercingLine(c, prev1),
          P.detectDarkCloudCover(c, prev1),
          P.detectTweezers(c, prev1),
        ]
    const triples =
      flat(prev1) || flat(prev2)
        ? []
        : [
            P.detectMorningStar(c, prev1, prev2),
            P.detectEveningStar(c, prev1, prev2),
            P.detectThreeWhiteSoldiers(c, prev1, prev2),
            P.detectThreeBlackCrows(c, prev1, prev2),
          ]
    ;[...singles, ...doubles, ...triples].forEach((r) => {
      if (r)
        hits.push({ name: r.name, type: r.type, confidence: r.confidence, index: i, time: c.time })
    })
  }
  return hits
}

export function detectPatterns(candles: OHLCCandle[]): PatternResult[] {
  if (!candles || candles.length < 3) return []
  const results: PatternResult[] = []
  const len = candles.length
  const c = candles[len - 1]
  const prev1 = candles[len - 2]
  const prev2 = candles[len - 3]
  const history = candles.slice(0, len - 1)
  if (flat(c)) return []

  const singles = [
    P.detectDoji(c),
    P.detectLongLeggedDoji(c),
    P.detectGravestoneDoji(c),
    P.detectDragonflyDoji(c),
    P.detectMarubozu(c),
    P.detectSpinningTop(c),
    P.detectHammer(c, history),
    P.detectHangingMan(c, history),
    P.detectInvertedHammer(c, history),
    P.detectShootingStar(c, history),
  ]

  const doubles = flat(prev1)
    ? []
    : [
        P.detectBullishEngulfing(c, prev1),
        P.detectBearishEngulfing(c, prev1),
        P.detectBullishHarami(c, prev1),
        P.detectBearishHarami(c, prev1),
        P.detectPiercingLine(c, prev1),
        P.detectDarkCloudCover(c, prev1),
        P.detectTweezers(c, prev1),
      ]

  const triples =
    flat(prev1) || flat(prev2)
      ? []
      : [
          P.detectMorningStar(c, prev1, prev2),
          P.detectEveningStar(c, prev1, prev2),
          P.detectThreeWhiteSoldiers(c, prev1, prev2),
          P.detectThreeBlackCrows(c, prev1, prev2),
        ]

  ;[...singles, ...doubles, ...triples].forEach((r) => {
    if (r) results.push(r)
  })

  return results.sort((a, b) => b.confidence - a.confidence)
}
