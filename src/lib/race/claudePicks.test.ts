import { describe, expect, it } from 'vitest'
import { checkPick, checkPicks, parsePicks, swings, type PickContext } from './claudePicks'
import type { LiveTrade } from './live'

// GBP/USD at 1.3000 with a 15m ATR of 0.0010 (10 pips).
const ctx: PickContext = {
  prices: { 'GBP-USD': 1.3, 'GBP-JPY': 205, 'pax-gold': 4000 },
  atr15: { 'GBP-USD': 0.001, 'GBP-JPY': 0.2, 'pax-gold': 5 },
  open: [],
}
const good = {
  market: 'GBP-USD',
  direction: 'long',
  stop: 1.299,
  target: 1.302,
  reason: 'Held the Asian low.',
}
const reason = (raw: unknown, c = ctx) => {
  const r = checkPick(raw, c)
  return r.ok ? 'ok' : r.reason
}
const openTrade = (over: Partial<LiveTrade>): LiveTrade => ({
  market: 'GBP-USD',
  direction: 'long',
  signalTime: 1,
  entryTime: 1,
  entryBucket: 1,
  entry: 1.3,
  stop: 1.299,
  takeProfit: 1.302,
  units: 1,
  usdPerQuote: 1,
  margin: 1,
  entryFee: 0,
  ...over,
})

describe("Claude's picks: reading the answer", () => {
  it('reads plain JSON, JSON in a code fence, and an empty list', () => {
    expect(parsePicks(JSON.stringify({ trades: [good] }))).toEqual({ ok: true, raw: [good] })
    expect(parsePicks('```json\n{"trades":[]}\n```')).toEqual({ ok: true, raw: [] })
  })

  it('calls junk junk', () => {
    expect(parsePicks('I would not trade today.')).toEqual({
      ok: false,
      error: 'no JSON in the answer',
    })
    expect(parsePicks('{"trades": [oops]}').ok).toBe(false)
    expect(parsePicks('{"picks": []}')).toEqual({ ok: false, error: 'no "trades" list' })
  })
})

describe("Claude's picks: checking each trade", () => {
  it('accepts a trade inside every rule, and cleans the market name and reason', () => {
    const r = checkPick({ ...good, market: 'gbp/usd', reason: '  Two\n lines. ' }, ctx)
    expect(r).toEqual({ ok: true, pick: { ...good, reason: 'Two lines.' } })
    expect(checkPick({ ...good, market: 'XAU/USD', stop: 3995, target: 4010 }, ctx).ok).toBe(true)
  })

  it('only the allowed markets and directions', () => {
    expect(reason({ ...good, market: 'EUR-USD' })).toMatch(/not one of/)
    expect(reason({ ...good, direction: 'buy' })).toMatch(/long or short/)
    expect(reason({ ...good, stop: 'low' })).toMatch(/must be prices/)
  })

  it('stop and target on the correct side of the current price', () => {
    expect(reason({ ...good, stop: 1.301 })).toMatch(/stop is on the wrong side/)
    expect(reason({ ...good, direction: 'short', stop: 1.299, target: 1.297 })).toMatch(
      /stop is on the wrong side/,
    )
    expect(reason({ ...good, target: 1.2995 })).toMatch(/target is on the wrong side/)
    expect(reason({ market: 'GBP-USD', direction: 'short', stop: 1.301, target: 1.298 })).toBe('ok')
  })

  it('stop between 0.5x and 3x the 15m ATR', () => {
    expect(reason({ ...good, stop: 1.2996, target: 1.302 })).toMatch(/0.40x the 15m ATR/)
    expect(reason({ ...good, stop: 1.2965, target: 1.31 })).toMatch(/3.50x the 15m ATR/)
    expect(reason({ ...good, stop: 1.2995, target: 1.30075 })).toBe('ok') // exactly 0.5x, 1.5R
    expect(reason({ ...good, stop: 1.297, target: 1.3045 })).toBe('ok') // exactly 3x, 1.5R
  })

  it('reward at least 1.5x the risk', () => {
    expect(reason({ ...good, target: 1.3014 })).toMatch(/1.40x the risk/)
  })

  it('never against (or on top of) an open pick on that market', () => {
    const longOpen = { ...ctx, open: [openTrade({ direction: 'long' })] }
    expect(
      reason({ market: 'GBP-USD', direction: 'short', stop: 1.301, target: 1.298 }, longOpen),
    ).toMatch(/against the open pick/)
    expect(reason(good, longOpen)).toMatch(/already open/)
    expect(reason({ ...good, market: 'pax-gold', stop: 3995, target: 4010 }, longOpen)).toBe('ok')
  })

  it('keeps at most 2 picks, one per market', () => {
    const gold = { ...good, market: 'pax-gold', stop: 3995, target: 4010 }
    const yen = { ...good, market: 'GBP-JPY', stop: 204.8, target: 205.4 }
    const r = checkPicks([good, { ...good, target: 1.303 }, gold, yen, { market: 'BTC' }], ctx)
    expect(r.accepted.map((p) => p.market)).toEqual(['GBP-USD', 'pax-gold'])
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'one pick per market (GBP-USD)',
      'only 2 picks a day',
      'only 2 picks a day',
    ])
  })
})

describe("Claude's picks: brief helpers", () => {
  it('finds the nearest swing highs above and lows below the price', () => {
    const h = [1, 2, 5, 2, 1, 2, 7, 2, 1, 1].map((v, i) => ({
      time: i * 3600,
      open: v,
      high: v,
      low: 10 - v,
      close: v,
    }))
    expect(swings(h, 4)).toEqual({ above: [5, 7], below: [3] })
  })
})
