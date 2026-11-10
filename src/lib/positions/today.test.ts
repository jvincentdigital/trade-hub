import { describe, expect, it } from 'vitest'
import { measure, type ClosedRow, type OpenPosition } from './positions'
import {
  closedTodayLine,
  closestToTarget,
  goalBar,
  lookLine,
  needsLook,
  openCountLine,
  pnlSeries,
  priceFor,
  rowLine,
  shortName,
  signedShort,
  track,
  usdShort,
  wayText,
  whyLevels,
} from './today'

const long: OpenPosition = {
  key: 'a',
  source: 'race',
  by: 'EMA 50 pullback',
  ruleId: 'ema50-pullback',
  market: 'pax-gold',
  side: 'long',
  entry: 100,
  stop: 90,
  target: 120,
  units: 2,
  usdPerQuote: 1,
  openedAt: 0,
}
const short: OpenPosition = {
  ...long,
  key: 'b',
  market: 'avalanche-2',
  side: 'short',
  stop: 110,
  target: 80,
}
const row = (p: OpenPosition, price: number | null) => ({ pos: p, m: measure(p, price) })

describe('money', () => {
  it('drops zero cents, keeps real ones', () => {
    expect(usdShort(20)).toBe('$20')
    expect(usdShort(-19.6)).toBe('$19.60')
    expect(usdShort(1234.5)).toBe('$1,234.50')
    expect(signedShort(40)).toBe('+$40')
    expect(signedShort(-13.456)).toBe('-$13.46')
    expect(signedShort(0.001)).toBe('$0')
  })
})

describe('names', () => {
  it('short market names for sentences', () => {
    expect(shortName('pax-gold')).toBe('Gold')
    expect(shortName('avalanche-2')).toBe('AVAX')
    expect(shortName('GBP-USD')).toBe('GBP/USD')
    expect(shortName('nope')).toBe('nope')
  })
})

describe('priceFor', () => {
  const fx = { ...long, market: 'USD-JPY' }
  const live = { 'USD-JPY': 158.02, 'pax-gold': 4030 }
  const race = { 'USD-JPY': 158.18, 'pax-gold': 4022 }
  it('race forex trades use the race rate; the rest use live first', () => {
    expect(priceFor(fx, live, race)).toBe(158.18)
    expect(priceFor({ ...fx, source: 'demo' }, live, race)).toBe(158.02)
    expect(priceFor(long, live, race)).toBe(4030)
    expect(priceFor(long, {}, race)).toBe(4022)
    expect(priceFor(fx, live, undefined)).toBe(158.02)
  })
})

describe('track (stop-to-target bar)', () => {
  it('long: entry a third of the way, price placed and clamped', () => {
    const t = track(long, 110)!
    expect(t.entryAt).toBeCloseTo(1 / 3)
    expect(t.nowAt).toBeCloseTo(2 / 3)
    expect(track(long, 200)!.nowAt).toBe(1)
    expect(track(long, 50)!.nowAt).toBe(0)
    expect(track(long, null)!.nowAt).toBeNull()
  })

  it('short: stop is still the left end', () => {
    const t = track(short, 95)!
    expect(t.entryAt).toBeCloseTo(1 / 3)
    expect(t.nowAt).toBeCloseTo(0.5)
  })

  it('no bar without a stop or a target', () => {
    expect(track({ ...long, stop: undefined }, 100)).toBeNull()
    expect(track({ ...long, target: undefined }, 100)).toBeNull()
  })
})

describe('row line', () => {
  it('risk, goal and how far along', () => {
    expect(rowLine(long, measure(long, 109.6))).toBe(
      'Risk $20 · Goal +$40 · 48% of the way to target',
    )
    expect(rowLine(long, measure(long, 97))).toBe('Risk $20 · Goal +$40 · 30% of the way to stop')
    expect(rowLine(short, measure(short, 99.99))).toBe(
      'Risk $20 · Goal +$40 · Under 1% of the way to target',
    )
  })

  it('at entry: forex says why it is not moving', () => {
    const fx = { ...long, market: 'GBP-USD' }
    expect(rowLine(fx, measure(fx, 100))).toBe(
      'Risk $20 · Goal +$40 · At entry; forex prices update once a day',
    )
    expect(wayText(long, 100)).toBe('At entry')
  })

  it('no stop, no target, no price', () => {
    const bare = { ...long, stop: undefined, target: undefined }
    expect(rowLine(bare, measure(bare, 110))).toBe('No stop · In profit, no target set')
    expect(wayText(bare, 90)).toBe('In a loss, no stop set')
    expect(wayText(long, null)).toBe('No live price yet')
  })
})

describe('summary line', () => {
  it('nothing needs a look: names the trade closest to its target', () => {
    const rows = [row(long, 108.6), row(short, 98), row({ ...long, key: 'c' }, 95)]
    expect(closestToTarget(rows)?.row.pos.key).toBe('a')
    expect(lookLine(rows)).toBe('Nothing needs a look. Closest: Gold buy, 43% to target.')
  })

  it('nothing in profit', () => {
    expect(lookLine([row(long, 95), row(short, 100)])).toBe(
      'Nothing needs a look. No trade is in profit yet.',
    )
  })

  it('lists the trades that need a look, then how many more', () => {
    const rows = [row(short, 108), row(long, 117)]
    expect(lookLine(rows)).toBe('2 trades need a look: AVAX sell near stop, Gold buy near target.')
    const many = [...rows, row({ ...long, stop: undefined }, 100), row(short, 109)]
    expect(lookLine(many)).toBe(
      '4 trades need a look: AVAX sell near stop, Gold buy near target, Gold buy has no stop, and 1 more.',
    )
    expect(lookLine([row(short, 108)])).toBe('1 trade needs a look: AVAX sell near stop.')
  })

  it('no price is not a look; no rows is no line', () => {
    expect(needsLook('No price')).toBe(false)
    expect(lookLine([row(long, null)])).toBe('Waiting for live prices.')
    expect(lookLine([])).toBeNull()
  })
})

describe('closed today', () => {
  const now = new Date(2026, 10, 10, 15, 0).getTime()
  const closed = (pnl: number, closedAt: number): ClosedRow => ({
    key: String(closedAt),
    by: 'x',
    market: 'bitcoin',
    side: 'long',
    pnl,
    closedAt,
    reason: pnl > 0 ? 'target' : 'stop',
  })

  it('counts only today, after fees', () => {
    const rows = [
      closed(10, now - 3_600_000),
      closed(3.45, now - 60_000),
      closed(-20, now - 86_400_000),
    ]
    expect(closedTodayLine(rows, now)).toBe('Closed today: 2 of 2 won, +$13.45 after fees')
    expect(closedTodayLine([closed(-20, now - 1000), closed(5, now - 2000)], now)).toBe(
      'Closed today: 1 of 2 won, -$15 after fees',
    )
  })

  it('hidden when nothing closed today', () => {
    expect(closedTodayLine([closed(5, now - 86_400_000)], now)).toBeNull()
    expect(closedTodayLine([], now)).toBeNull()
  })
})

describe('open count line', () => {
  const demo = { ...long, key: 'd', source: 'demo' as const, by: 'Demo', ruleId: undefined }
  it('race, demo and both', () => {
    expect(openCountLine([long, short, { ...long, by: 'Other' }], 9)).toBe(
      '3 open trades from 2 of 9 strategies',
    )
    expect(openCountLine([demo], 9)).toBe('1 open trade, all demo')
    expect(openCountLine([long, demo, demo], 9)).toBe(
      '3 open trades: 1 from 1 of 9 strategies, 2 demo',
    )
  })
})

describe('goal bar', () => {
  it('places $0 and the open P&L between all stops and all targets', () => {
    expect(goalBar({ stop: -100, target: 300 }, 0)).toEqual({ zero: 25, now: 25 })
    expect(goalBar({ stop: -100, target: 300 }, 100)!.now).toBe(50)
    expect(goalBar({ stop: -100, target: 300 }, 999)!.now).toBe(100)
    expect(goalBar({ stop: 0, target: 0 }, 0)).toBeNull()
  })
})

describe('pnl series', () => {
  const H = 3_600_000
  const t0 = 1_000 * H
  const candles = (base: number, closes: number[]) =>
    closes.map((close, i) => ({
      time: base / 1000 + i * 3600,
      open: close,
      high: close,
      low: close,
      close,
    }))

  it('starts at zero at the first entry and ends at the live P&L', () => {
    const p = { ...long, openedAt: t0 }
    // Candles opening at t0, t0+1h, t0+2h; their closes land an hour later.
    const s = pnlSeries([p], { 'pax-gold': candles(t0, [101, 103, 102]) }, t0 + 3.5 * H, 7)
    expect(s[0]).toEqual({ t: t0, pnl: 0 })
    expect(s.map((x) => x.pnl)).toEqual([0, 2, 6, 4, 7]) // units 2
    expect(s.at(-1)!.t).toBe(t0 + 3.5 * H)
  })

  it('a later trade joins at its entry; trades without a dollar rate are left out', () => {
    const a = { ...long, openedAt: t0 }
    const b = { ...short, openedAt: t0 + 2 * H, entry: 100 }
    const s = pnlSeries(
      [a, b, { ...long, usdPerQuote: null }],
      { 'pax-gold': candles(t0, [101, 101, 101]), 'avalanche-2': candles(t0, [99, 99, 99]) },
      t0 + 3.5 * H,
      0,
    )
    // At t0+3h: gold +2, AVAX short entered at t0+2h, candle closing at t0+3h = 99 -> +2.
    expect(s.find((x) => x.t === t0 + 3 * H)!.pnl).toBeCloseTo(4)
    expect(s.find((x) => x.t === t0 + 2 * H)!.pnl).toBeCloseTo(2)
  })

  it('empty without trades', () => {
    expect(pnlSeries([], {}, t0, 0)).toEqual([])
  })
})

describe('why these levels', () => {
  const rule = {
    stop: { kind: 'swing' as const, lookback: 5, bufferPct: 0.3 },
    rr: 2,
    timeframe: '4h' as const,
  }
  it('swing stop and the target ratio', () => {
    expect(whyLevels(long, rule)).toBe(
      'Stop just past the lowest low of the last 5 4-hour candles, plus 0.3%. Target 2 times the stop distance.',
    )
    expect(whyLevels({ ...short, target: 75 }, rule)).toBe(
      'Stop just past the highest high of the last 5 4-hour candles, plus 0.3%. Target aims for 2 times the stop distance; the fill came after the signal, so this one is 2.5 times.',
    )
  })

  it('demo trades', () => {
    expect(whyLevels({ ...long, ruleId: undefined })).toBe(
      'You set this stop and target when you placed it in Demo.',
    )
    expect(whyLevels({ ...long, stop: undefined })).toBe(
      'No stop was set in Demo, so the loss is not capped.',
    )
  })
})
