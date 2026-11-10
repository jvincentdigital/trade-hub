import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import type { BacktestResult, BacktestTrade, Signal } from '../rules/engine'
import { closedOnly, resample } from './candles'
import { rankEntries, scoreStrategy, shareOf } from './leaderboard'
import { createRaceState, raceStateSchema, stepSlot, summarize, type Slot } from './live'

const H = 3600
const bar = (time: number, o: number, h: number, l: number, c: number): OHLCCandle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
})

describe('candles', () => {
  it('resamples 1h into 4h on UTC boundaries', () => {
    const t0 = 1_700_000_000 - (1_700_000_000 % (4 * H))
    const hourly = [
      bar(t0, 10, 12, 9, 11),
      bar(t0 + H, 11, 15, 10, 14),
      bar(t0 + 2 * H, 14, 14, 8, 9),
      bar(t0 + 3 * H, 9, 10, 9, 10),
      bar(t0 + 4 * H, 10, 11, 10, 11),
    ]
    const four = resample(hourly, 4)
    expect(four).toHaveLength(2)
    expect(four[0]).toEqual(bar(t0, 10, 15, 8, 10))
    expect(four[1]).toEqual(bar(t0 + 4 * H, 10, 11, 10, 11))
  })

  it('drops the candle that is still forming', () => {
    const c = [bar(0, 1, 1, 1, 1), bar(4 * H, 1, 1, 1, 1)]
    expect(closedOnly(c, 4, 8 * H)).toHaveLength(2)
    expect(closedOnly(c, 4, 8 * H - 1)).toHaveLength(1)
  })
})

const slot = (balance = 100): Slot => ({ balance, open: null, lastSignalTime: 0 })
const sig = (over: Partial<Signal> = {}): Signal => ({
  index: 0,
  time: 1000,
  direction: 'long',
  entry: 100,
  stop: 95,
  takeProfit: 110,
  ...over,
})
const base = { market: 'bitcoin', nowSec: 5000, riskPct: 1, feeRate: 0.001, leverage: 1 }

describe('live forward test step', () => {
  it('opens on a new signal at the latest price, risk-sized, paying the entry fee', () => {
    const r = stepSlot(slot(), {
      ...base,
      signal: sig(),
      path: [bar(4000, 100, 100, 100, 100)],
      price: 100,
    })
    // 1% of $100 at a 5% stop = $20 position; 0.1% fee = 2 cents
    expect(r.opened?.notional).toBeCloseTo(20)
    expect(r.opened?.entryFee).toBeCloseTo(0.02)
    expect(r.slot.balance).toBeCloseTo(99.98)
    expect(r.slot.lastSignalTime).toBe(1000)
    expect(r.opened?.entryBucket).toBe(4000)
  })

  it('uses one signal only once and caps the size at the leverage', () => {
    const first = stepSlot(slot(), {
      ...base,
      signal: sig({ stop: 99.9 }),
      path: [bar(4000, 100, 100, 100, 100)],
      price: 100,
    })
    // 1% risk on a 0.1% stop would be 10x; spot crypto caps it at 1x
    expect(first.opened?.notional).toBeCloseTo(100)
    const closedSlot: Slot = { ...first.slot, open: null }
    const again = stepSlot(closedSlot, {
      ...base,
      signal: sig({ stop: 99.9 }),
      path: [bar(4000, 100, 100, 100, 100)],
      price: 100,
    })
    expect(again.opened).toBeNull()
  })

  it('skips a signal whose stop or target the price already passed', () => {
    const r = stepSlot(slot(), {
      ...base,
      signal: sig(),
      path: [bar(4000, 111, 111, 111, 111)],
      price: 111,
    })
    expect(r.opened).toBeNull()
    expect(r.slot.lastSignalTime).toBe(1000)
  })

  const opened = () =>
    stepSlot(slot(), { ...base, signal: sig(), path: [bar(4000, 100, 100, 100, 100)], price: 100 })
      .slot

  it('closes at the target on a later candle, both fees counted', () => {
    const s = opened()
    const r = stepSlot(s, {
      ...base,
      signal: null,
      // the entry candle itself is ignored even though it dipped
      path: [bar(4000, 100, 100, 90, 100), bar(4000 + H, 100, 111, 99, 108)],
      price: 108,
    })
    expect(r.closed?.reason).toBe('target')
    expect(r.closed?.exit).toBe(110)
    // +10% of $20 = $2.00, fees 0.02 + 0.022
    expect(r.closed?.pnl).toBeCloseTo(2 - 0.042)
    expect(r.slot.balance).toBeCloseTo(100 + 2 - 0.042)
    expect(r.slot.open).toBeNull()
  })

  it('checks the stop first when a candle touches both, and fills a gap at the open', () => {
    const both = stepSlot(opened(), {
      ...base,
      signal: null,
      path: [bar(4000 + H, 100, 111, 94, 100)],
      price: 100,
    })
    expect(both.closed?.reason).toBe('stop')
    expect(both.closed?.exit).toBe(95)
    expect(both.closed?.pnl).toBeCloseTo(-1 - 0.02 - 0.019)

    const gap = stepSlot(opened(), {
      ...base,
      signal: null,
      path: [bar(4000 + H, 90, 91, 89, 90)],
      price: 90,
    })
    expect(gap.closed?.exit).toBe(90)
  })

  it('shorts make money when price falls', () => {
    const s = stepSlot(slot(), {
      ...base,
      signal: sig({ direction: 'short', stop: 105, takeProfit: 90 }),
      path: [bar(4000, 100, 100, 100, 100)],
      price: 100,
    }).slot
    const r = stepSlot(s, {
      ...base,
      signal: null,
      path: [bar(4000 + H, 99, 99, 89, 90)],
      price: 90,
    })
    expect(r.closed?.reason).toBe('target')
    expect(r.closed!.pnl).toBeGreaterThan(0)
  })

  it('creates a valid state split evenly and summarizes money with open P&L', () => {
    const st = createRaceState([{ id: 'a', name: 'A', markets: ['bitcoin', 'ethereum'] }], 1000, 1)
    expect(raceStateSchema.safeParse(st).success).toBe(true)
    expect(st.strategies.a.slots.bitcoin.balance).toBe(500)
    st.strategies.a.slots.bitcoin = stepSlot(st.strategies.a.slots.bitcoin, {
      ...base,
      signal: sig(),
      path: [bar(4000, 100, 100, 100, 100)],
      price: 100,
    }).slot
    st.prices.bitcoin = 105
    const [s] = summarize(st)
    // $100 position (1% of 500 at a 5% stop), +5% = +$5, minus the $0.10 entry fee
    expect(s.money).toBeCloseTo(1000 + 5 - 0.1)
    expect(s.open).toHaveLength(1)
  })
})

function result(rs: number[], exitTimes = rs.map((_, i) => i + 1)): BacktestResult {
  const trades: BacktestTrade[] = rs.map((r, i) => ({
    direction: 'long',
    entryTime: 0,
    exitTime: exitTimes[i],
    entry: 1,
    exit: 1,
    stop: 1,
    takeProfit: 1,
    r,
    reason: r > 0 ? 'target' : 'stop',
  }))
  let eq = 1
  for (const r of rs) eq *= 1 + r * 0.01
  return {
    trades,
    signals: [],
    stats: {} as BacktestResult['stats'],
    totalR: 0,
    startEquity: 1,
    endEquity: eq,
    candles: 0,
    from: null,
    to: null,
  }
}

describe('leaderboard', () => {
  it('splits money evenly and keeps a skipped market share as cash', () => {
    expect(shareOf(1000, 4)).toBe(250)
    const e = scoreStrategy({
      ruleId: 'x',
      riskPct: 1,
      start: 1000,
      runs: [
        { id: 'bitcoin', result: result([2, -1]) },
        { id: 'ethereum', result: result([]) },
      ],
      skipped: ['solana', 'ripple'],
    })
    // bitcoin share $250: +2% = +5, then -1% of 255 = -2.55
    expect(e.markets[0].profit).toBeCloseTo(5 - 2.55)
    expect(e.end).toBeCloseTo(1000 + 2.45)
    expect(e.trades).toBe(2)
    expect(e.winRate).toBe(0.5)
    expect(e.best).toBe('bitcoin')
    expect(e.perMonth).toBeCloseTo((2.45 / 90) * 30)
    // peak 1005, low 1002.45
    expect(e.maxDrawdown).toBeCloseTo(2.55 / 1005)
    // per-market result matches the backtest's own compounding
    expect(e.markets[0].end).toBeCloseTo(250 * result([2, -1]).endEquity)
  })

  it('ranks by end money, ties to fewer trades', () => {
    const mk = (ruleId: string, rs: number[]) =>
      scoreStrategy({
        ruleId,
        riskPct: 1,
        start: 1000,
        runs: [{ id: 'bitcoin', result: result(rs) }],
        skipped: [],
      })
    const ranked = rankEntries([
      mk('lose', [-1]),
      mk('none', []),
      mk('win', [3]),
      mk('busy', [1, -1, 0]),
    ])
    expect(ranked.map((r) => r.ruleId)[0]).toBe('win')
    expect(ranked.at(-1)?.ruleId).toBe('lose')
    expect(ranked.findIndex((r) => r.ruleId === 'none')).toBeLessThan(
      ranked.findIndex((r) => r.ruleId === 'lose'),
    )
    const tie = rankEntries([mk('flat', [0]), mk('none', [])])
    expect(tie.map((r) => r.ruleId)).toEqual(['none', 'flat'])
    const noTrades = mk('none', [])
    expect(noTrades.best).toBeNull()
    expect(noTrades.winRate).toBeNull()
  })
})
