import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import {
  backtest,
  describeCondition,
  findSignals,
  inSession,
  latestSignal,
  stopFor,
} from './engine'
import { BUILT_IN_RULES } from './presets'
import { ruleSchema, type Rule } from './schema'

const H = 3600

/** Each candle moves `pct` % from the previous close. */
function series(n: number, pct: number, start = 100, t0 = 1_700_000_000): OHLCCandle[] {
  const out: OHLCCandle[] = []
  let price = start
  for (let i = 0; i < n; i++) {
    const open = price
    const close = open * (1 + pct / 100)
    out.push({
      time: t0 + i * H,
      open,
      close,
      high: Math.max(open, close),
      low: Math.min(open, close),
    })
    price = close
  }
  return out
}

const base: Rule = {
  id: 't',
  name: 'test',
  summary: '',
  market: 'crypto',
  pairs: [],
  timeframe: '1h',
  direction: 'long',
  conditions: [{ kind: 'trend', period: 5 }],
  stop: { kind: 'percent', pct: 1 },
  rr: 2,
  riskPct: 1,
  sessions: [],
  sources: [],
}

describe('signals', () => {
  it('trend filter fires once the EMA exists and price is above it', () => {
    const sigs = findSignals(base, series(20, 1))
    expect(sigs[0].index).toBe(4)
    expect(sigs.every((s) => s.direction === 'long')).toBe(true)
    expect(findSignals({ ...base, direction: 'short' }, series(20, 1))).toHaveLength(0)
  })

  it('sets the target at rr × the stop distance', () => {
    const s = findSignals(base, series(10, 1))[0]
    expect(s.stop).toBeCloseTo(s.entry * 0.99)
    expect(s.takeProfit - s.entry).toBeCloseTo(2 * (s.entry - s.stop))
  })

  it('has no look-ahead: signals on a prefix match the full run', () => {
    const rule: Rule = {
      ...base,
      direction: 'both',
      conditions: [{ kind: 'rsi', period: 5, longBelow: 40, shortAbove: 60 }],
    }
    const full = [
      ...series(15, 1),
      ...series(15, -1, series(15, 1)[14].close, 1_700_000_000 + 15 * H),
    ]
    const prefix = full.slice(0, 20)
    const a = findSignals(rule, prefix).map((s) => s.index)
    const b = findSignals(rule, full)
      .map((s) => s.index)
      .filter((i) => i < 20)
    expect(a).toEqual(b)
  })

  it('RSI condition flags longs after a selloff and shorts after a rally', () => {
    const rule: Rule = {
      ...base,
      direction: 'both',
      conditions: [{ kind: 'rsi', period: 5, longBelow: 30, shortAbove: 70 }],
    }
    expect(latestSignal(rule, series(20, -1))?.direction).toBe('long')
    expect(latestSignal(rule, series(20, 1))?.direction).toBe('short')
  })

  it('swing stop sits beyond the recent extreme plus buffer', () => {
    const c = series(10, 1)
    const rule: Rule = { ...base, stop: { kind: 'swing', lookback: 3, bufferPct: 1 } }
    expect(stopFor(rule, 'long', c, 9, c[9].close)).toBeCloseTo(c[7].low * 0.99)
  })
})

describe('sessions', () => {
  // 2026-11-10 14:00 UTC = 09:00 New York (EST)
  const nineAm = Date.UTC(2026, 10, 10, 14) / 1000
  const win = [{ label: 'x', start: 8, end: 12 }]
  it('keeps candles that overlap a window', () => {
    expect(inSession(win, nineAm, '1h')).toBe(true)
    expect(inSession(win, nineAm - 6 * H, '1h')).toBe(false)
    expect(inSession(win, nineAm - 3 * H, '4h')).toBe(true) // 06:00-10:00 overlaps 8-12
  })
  it('handles windows that end at midnight and ignores daily candles', () => {
    expect(inSession([{ label: 'asia', start: 20, end: 24 }], nineAm + 12 * H, '1h')).toBe(true)
    expect(inSession(win, nineAm - 6 * H, '1d')).toBe(true)
  })
})

describe('backtest', () => {
  it('enters next open, hits the target and compounds by riskPct', () => {
    const r = backtest(base, series(12, 1))
    expect(r.trades.length).toBeGreaterThan(0)
    const t = r.trades[0]
    expect(t.reason).toBe('target')
    expect(t.r).toBeCloseTo(2)
    expect(r.endEquity).toBeGreaterThan(r.startEquity)
    expect(r.stats.winRate).toBe(1)
  })

  it('assumes the stop first when one candle touches both levels', () => {
    const c = series(8, 1)
    // Candle after the first signal swings 10% both ways.
    const wild: OHLCCandle[] = c.slice(0, 5)
    wild.push({
      time: c[5].time,
      open: c[4].close,
      close: c[4].close,
      high: c[4].close * 1.1,
      low: c[4].close * 0.9,
    })
    const r = backtest(base, wild)
    expect(r.trades[0].reason).toBe('stop')
    expect(r.trades[0].r).toBeCloseTo(-1)
  })

  it('fees reduce R', () => {
    const clean = backtest(base, series(12, 1)).trades[0].r
    const withFees = backtest(base, series(12, 1), { feeRate: 0.001 }).trades[0].r
    expect(withFees).toBeLessThan(clean)
  })

  it('closes a still-open trade at the end of the data', () => {
    const rule: Rule = { ...base, rr: 50 }
    const r = backtest(rule, series(12, 1))
    expect(r.trades.at(-1)?.reason).toBe('end')
  })
})

describe('presets', () => {
  it('are valid rules with readable conditions', () => {
    for (const rule of BUILT_IN_RULES) {
      expect(() => ruleSchema.parse(rule)).not.toThrow()
      rule.conditions.forEach((c) => expect(describeCondition(c).length).toBeGreaterThan(10))
    }
  })
  it('run on 500 flat-ish candles without throwing', () => {
    const wobble = series(500, 0).map((c, i) => {
      const p = 100 + Math.sin(i / 7) * 5 + Math.sin(i / 31) * 8
      return { ...c, open: p - 0.3, close: p + (i % 3 === 0 ? -0.5 : 0.5), high: p + 1, low: p - 1 }
    })
    for (const rule of BUILT_IN_RULES) {
      const r = backtest(rule, wobble, { feeRate: 0.001 })
      expect(r.candles).toBe(500)
      expect(Number.isFinite(r.endEquity)).toBe(true)
    }
  })
})

describe('backtest sizing', () => {
  it('caps the position at equity × leverage when the stop is very tight', () => {
    // 0.01% stop with 1% risk would need 100× equity; at 1× leverage the
    // loss on a stop-out is limited to about the stop distance plus fees.
    const rule: Rule = { ...base, stop: { kind: 'percent', pct: 0.01 }, rr: 1000 }
    const falling = [
      ...series(10, 1),
      ...series(5, -2, series(10, 1)[9].close, 1_700_000_000 + 10 * H),
    ]
    const r = backtest(rule, falling, { feeRate: 0.001, leverage: 1 })
    expect(r.endEquity).toBeGreaterThan(r.startEquity * 0.95)
  })
})

describe('streak condition', () => {
  it('fires a buy after N down candles and not before', () => {
    const rule: Rule = { ...base, direction: 'both', conditions: [{ kind: 'streak', length: 3 }] }
    const c = series(6, -1)
    const sigs = findSignals(rule, c)
    expect(sigs[0].index).toBe(3)
    expect(sigs.every((s) => s.direction === 'long')).toBe(true)
  })
})

describe('backtest tradeFrom', () => {
  it('warms up indicators on early candles but only trades signals from tradeFrom on', () => {
    const c = series(40, 1)
    const all = backtest(base, c)
    const late = backtest(base, c, { tradeFrom: c[30].time })
    expect(all.trades[0].entryTime).toBeLessThan(c[30].time)
    expect(late.trades.length).toBeGreaterThan(0)
    expect(late.trades.every((t) => t.entryTime > c[30].time)).toBe(true)
  })
})
