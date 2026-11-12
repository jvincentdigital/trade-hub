import { describe, expect, it } from 'vitest'
import { entryWindowBlock, nextPragueDayStart, pragueDate, pragueDayStart } from './session'
import {
  createRaceState,
  parseRaceState,
  REASON_TEXT,
  stepStrategy,
  type LiveTrade,
  type MarketTick,
} from './live'

/** Unix seconds of a Puerto Rico (AST = UTC-4) wall clock time. */
const ast = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) =>
  Date.UTC(y, mo - 1, d, h + 4, mi, s) / 1000
const utc = (y: number, mo: number, d: number, h: number, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) / 1000

// 2026-11-11 is a Wednesday; 2026-11-13 Friday, 14 Saturday, 16 Monday.
describe('entry window: new trades only 02:00 to 12:30 AST on weekdays', () => {
  it('opens at 02:00 and closes after 12:30', () => {
    expect(entryWindowBlock(ast(2026, 11, 11, 1, 59, 59))).toBe(
      'new trades only from 02:00 to 12:30 AST',
    )
    expect(entryWindowBlock(ast(2026, 11, 11, 2, 0))).toBeNull()
    expect(entryWindowBlock(ast(2026, 11, 11, 12, 30))).toBeNull()
    expect(entryWindowBlock(ast(2026, 11, 11, 12, 30, 59))).toBeNull()
    expect(entryWindowBlock(ast(2026, 11, 11, 12, 31))).toBe(
      'new trades only from 02:00 to 12:30 AST',
    )
    expect(entryWindowBlock(ast(2026, 11, 11, 20, 0))).not.toBeNull()
  })

  it('no new trades on Saturday or Sunday, even inside the hours', () => {
    expect(entryWindowBlock(ast(2026, 11, 14, 9, 0))).toBe('no new trades on the weekend')
    expect(entryWindowBlock(ast(2026, 11, 15, 9, 0))).toBe('no new trades on the weekend')
    expect(entryWindowBlock(ast(2026, 11, 13, 9, 0))).toBeNull() // Friday
    expect(entryWindowBlock(ast(2026, 11, 16, 2, 0))).toBeNull() // Monday
  })

  it('a signal outside the window is used up and passed with the reason', () => {
    const s = createRaceState([{ id: 'a', name: 'A' }], 10_000, 0).strategies.a
    const tick: MarketTick = {
      market: 'GBP-USD',
      signal: { index: 0, time: 100, direction: 'long', entry: 1.3, stop: 1.29, takeProfit: 1.32 },
      path: [{ time: 50, open: 1.3, high: 1.3, low: 1.3, close: 1.3 }],
      price: 1.3,
      usdPerQuote: 1,
      feeRate: 0,
      leverage: 30,
    }
    const at = ast(2026, 11, 11, 1, 59)
    const r = stepStrategy(s, [tick], at, undefined, entryWindowBlock(at))
    expect(r.opened).toHaveLength(0)
    expect(r.passed).toEqual([
      { market: 'GBP-USD', reason: 'new trades only from 02:00 to 12:30 AST' },
    ])
    // the same signal does not open later at 02:00 (it is old by then)
    const later = stepStrategy(r.strategy, [tick], ast(2026, 11, 11, 2, 0))
    expect(later.opened).toHaveLength(0)
  })
})

describe('trades hold until their stop or target (John, 2026-11-12)', () => {
  // Opened Wednesday 09:00 AST: long GBP/USD at 1.3, stop 1.29, target 1.32.
  const entry = ast(2026, 11, 11, 9, 0)
  const trade = (over: Partial<LiveTrade> = {}): LiveTrade => ({
    market: 'GBP-USD',
    direction: 'long',
    signalTime: 1,
    entryTime: entry,
    entryBucket: entry,
    entry: 1.3,
    stop: 1.29,
    takeProfit: 1.32,
    units: 20_000,
    usdPerQuote: 1,
    margin: 866.67,
    entryFee: 1.82,
    ...over,
  })
  /** 15-minute candles from the entry up to `now` that stay between 1.298 and 1.302. */
  const quietPath = (now: number) =>
    Array.from({ length: Math.floor((now - entry) / 900) }, (_, i) => ({
      time: entry + i * 900,
      open: 1.3,
      high: 1.302,
      low: 1.298,
      close: 1.3,
    }))
  const tick = (now: number, over: Partial<MarketTick> = {}): MarketTick => ({
    market: 'GBP-USD',
    signal: null,
    path: quietPath(now),
    price: 1.3,
    usdPerQuote: 1,
    feeRate: 0.00007,
    leverage: 30,
    ...over,
  })
  const account = () => {
    const s = createRaceState([{ id: 'a', name: 'A' }], 10_000, 0).strategies.a
    return { ...s, open: [trade()] }
  }

  it('past the old 12:45 close with no stop or target hit, it stays open across checks and days', () => {
    let s = account()
    for (const now of [
      ast(2026, 11, 11, 12, 45),
      ast(2026, 11, 11, 12, 52),
      ast(2026, 11, 11, 13, 7),
      ast(2026, 11, 11, 20, 7),
      ast(2026, 11, 12, 2, 0),
      ast(2026, 11, 12, 12, 52),
      ast(2026, 11, 16, 9, 0), // the next Monday, after a weekend
    ]) {
      const r = stepStrategy(s, [tick(now)], now, undefined, entryWindowBlock(now))
      expect(r.closed).toEqual([])
      expect(r.strategy.open).toHaveLength(1)
      s = r.strategy
    }
    expect(s.balance).toBe(10_000)
    // Days later its stop still closes it, on the candle that hit it.
    const now = ast(2026, 11, 16, 10, 0)
    const path = [
      ...quietPath(now),
      { time: now, open: 1.295, high: 1.296, low: 1.288, close: 1.29 },
    ]
    const r = stepStrategy(s, [tick(now + 900, { path })], now + 900)
    expect(r.closed.map((c) => [c.reason, c.exit, c.exitTime])).toEqual([['stop', 1.29, now]])
  })

  it('a race file from before keeps its open trades: the old deadline and daily close fields are dropped, so they hold too', () => {
    const st = createRaceState([{ id: 'a', name: 'A' }], 10_000, 0)
    st.strategies.a.open = [trade()]
    const old = JSON.parse(JSON.stringify(st))
    old.dailyCloseAt = ast(2026, 11, 10, 12, 45)
    old.strategies.a.open[0].deadline = ast(2026, 11, 11, 12, 30)
    const parsed = parseRaceState(old)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.state).not.toHaveProperty('dailyCloseAt')
    expect(parsed.state.strategies.a.open[0]).not.toHaveProperty('deadline')
    const now = ast(2026, 11, 11, 14, 7)
    const r = stepStrategy(parsed.state.strategies.a, [tick(now)], now)
    expect(r.closed).toEqual([])
    expect(r.strategy.open).toHaveLength(1)
  })

  it('old closed trades closed at 12:45 or at a time limit still read and keep their labels', () => {
    const st = createRaceState([{ id: 'a', name: 'A' }], 10_000, 0)
    const closed = (reason: string) => ({
      ...trade(),
      exitTime: entry + 3600,
      exit: 1.3,
      reason,
      pnl: -3.64,
      fees: 3.64,
    })
    const old = JSON.parse(JSON.stringify(st))
    old.strategies.a.closed = [closed('session'), closed('time')]
    const parsed = parseRaceState(old)
    expect(parsed.ok && parsed.state.strategies.a.closed.map((c) => REASON_TEXT[c.reason])).toEqual(
      ['closed at 12:45', 'closed at its time limit'],
    )
  })
})

describe("FTMO's day: midnight in Prague", () => {
  it('winter (CET): the day starts at 19:00 AST the evening before', () => {
    expect(pragueDayStart(ast(2026, 11, 11, 12, 0))).toBe(utc(2026, 11, 10, 23))
    expect(pragueDayStart(ast(2026, 11, 11, 18, 59))).toBe(ast(2026, 11, 10, 19))
    expect(pragueDayStart(ast(2026, 11, 11, 19, 0))).toBe(ast(2026, 11, 11, 19))
    expect(pragueDate(ast(2026, 11, 11, 18, 59))).toBe('2026-11-11')
    expect(pragueDate(ast(2026, 11, 11, 19, 0))).toBe('2026-11-12')
  })

  it('summer (CEST): the day starts at 18:00 AST', () => {
    expect(pragueDayStart(ast(2026, 7, 15, 17, 59))).toBe(ast(2026, 7, 14, 18))
    expect(pragueDayStart(ast(2026, 7, 15, 18, 0))).toBe(ast(2026, 7, 15, 18))
    expect(nextPragueDayStart(ast(2026, 7, 15, 9, 0))).toBe(ast(2026, 7, 15, 18))
  })

  it('the clock-change days: 23 hours in March, 25 in October', () => {
    // 2026-03-29: CET to CEST at 02:00 Prague
    const mar = pragueDayStart(utc(2026, 3, 29, 12))
    expect(mar).toBe(utc(2026, 3, 28, 23))
    expect(nextPragueDayStart(utc(2026, 3, 29, 12)) - mar).toBe(23 * 3600)
    expect(pragueDayStart(utc(2026, 3, 29, 0, 30))).toBe(mar) // before the change, same day
    // 2026-10-25: CEST to CET at 03:00 Prague
    const oct = pragueDayStart(utc(2026, 10, 25, 12))
    expect(oct).toBe(utc(2026, 10, 24, 22))
    expect(nextPragueDayStart(utc(2026, 10, 25, 12)) - oct).toBe(25 * 3600)
    expect(pragueDate(utc(2026, 10, 25, 22, 59))).toBe('2026-10-25')
    expect(pragueDate(utc(2026, 10, 25, 23, 0))).toBe('2026-10-26')
  })
})
