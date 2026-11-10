import { describe, it, expect } from 'vitest'
import { detectAll, detectPatterns } from './detector'
import { OHLCCandle } from '../types/market'

function c(open: number, high: number, low: number, close: number, time = 0): OHLCCandle {
  return { time, open, high, low, close }
}

describe('detectPatterns', () => {
  it('returns empty for fewer than 3 candles', () => {
    expect(detectPatterns([c(1, 1, 1, 1)])).toEqual([])
    expect(detectPatterns([])).toEqual([])
  })

  it('detects a Doji when open ~ close', () => {
    const candles = [c(100, 101, 99, 100.5), c(101, 102, 100, 101), c(100, 102, 98, 100.05)]
    const results = detectPatterns(candles)
    expect(results.some((r) => r.name === 'Doji')).toBe(true)
  })

  it('detects a Bullish Engulfing after a red candle', () => {
    const candles = [
      c(100, 101, 99, 100),
      c(100, 101, 99, 95), // bearish
      c(94, 102, 94, 101), // bullish engulfing: opens below prev close, closes above prev open
    ]
    const results = detectPatterns(candles)
    expect(results.some((r) => r.name === 'Bullish Engulfing')).toBe(true)
  })

  it('detects a Bearish Engulfing after a green candle', () => {
    const candles = [
      c(100, 101, 99, 100),
      c(95, 101, 94, 100), // bullish
      c(101, 102, 93, 94), // bearish engulfing
    ]
    const results = detectPatterns(candles)
    expect(results.some((r) => r.name === 'Bearish Engulfing')).toBe(true)
  })

  it('detects a Hammer after a downtrend', () => {
    // downtrend: prev slice (last 3 of prev) has strictly decreasing closes
    const candles = [
      c(110, 111, 109, 110),
      c(110, 110, 105, 105), // close 105
      c(105, 105, 100, 100), // close 100
      c(100, 100, 95, 96), //  close 96 → downtrend satisfied for prev 3
      c(98, 98, 88, 95), // body 3, lower shadow 7 (>2x body), upper shadow 0 → Hammer
    ]
    const results = detectPatterns(candles)
    expect(results.some((r) => r.name === 'Hammer')).toBe(true)
  })

  it('detects Three White Soldiers (three ascending bullish candles)', () => {
    const candles = [
      c(100, 100, 100, 100),
      c(100, 106, 99, 105),
      c(102, 111, 101, 110),
      c(107, 116, 106, 115),
    ]
    const results = detectPatterns(candles)
    expect(results.some((r) => r.name === 'Three White Soldiers')).toBe(true)
  })

  it('detects Three Black Crows (three descending bearish candles)', () => {
    const candles = [
      c(115, 115, 115, 115),
      c(115, 116, 109, 110),
      c(113, 114, 104, 105),
      c(108, 109, 99, 100),
    ]
    const results = detectPatterns(candles)
    expect(results.some((r) => r.name === 'Three Black Crows')).toBe(true)
  })

  it('detects a Bullish Marubozu (full body, no shadows)', () => {
    const candles = [
      c(100, 100, 100, 100),
      c(100, 100, 100, 100),
      c(100, 100, 100, 100),
      c(100, 110, 100, 110), // full bullish body, no shadows
    ]
    const results = detectPatterns(candles)
    expect(results.some((r) => r.name === 'Bullish Marubozu')).toBe(true)
  })

  it('sorts results by confidence descending', () => {
    const candles = [c(100, 101, 99, 100), c(100, 101, 99, 95), c(94, 102, 94, 101)]
    const results = detectPatterns(candles)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].confidence).toBeGreaterThanOrEqual(results[i].confidence)
    }
  })
})

describe('zero-range candles', () => {
  it('never tags a flat candle (high === low) as any pattern', () => {
    const flat = [c(100, 100, 100, 100, 0), c(101, 101, 101, 101, 1), c(102, 102, 102, 102, 2)]
    expect(detectPatterns(flat)).toEqual([])
    expect(detectAll([...flat, c(103, 103, 103, 103, 3)])).toEqual([])
  })

  it('still finds patterns on real candles next to flat ones', () => {
    const candles = [c(100, 100, 100, 100, 0), c(101, 102, 100, 101, 1), c(100, 102, 98, 100.05, 2)]
    expect(detectPatterns(candles).some((r) => r.name === 'Doji')).toBe(true)
  })
})
