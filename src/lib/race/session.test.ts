import { describe, expect, it } from 'vitest'
import {
  dailyCloseDue,
  entryWindowBlock,
  lastDailyClose,
  nextPragueDayStart,
  pragueDate,
  pragueDayStart,
} from './session'
import {
  applyDailyClose,
  createRaceState,
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

describe('daily close at 12:45 AST', () => {
  it('the latest weekday 12:45 at or before a time', () => {
    expect(lastDailyClose(ast(2026, 11, 11, 12, 45))).toBe(ast(2026, 11, 11, 12, 45))
    expect(lastDailyClose(ast(2026, 11, 11, 12, 44))).toBe(ast(2026, 11, 10, 12, 45))
    // weekend and Monday morning: Friday's
    expect(lastDailyClose(ast(2026, 11, 14, 12, 50))).toBe(ast(2026, 11, 13, 12, 45))
    expect(lastDailyClose(ast(2026, 11, 16, 9, 0))).toBe(ast(2026, 11, 13, 12, 45))
  })

  it('due at the first check at or after 12:45, once a day', () => {
    const morning = ast(2026, 11, 11, 9, 0)
    expect(dailyCloseDue(ast(2026, 11, 11, 12, 30), morning)).toBe(false)
    expect(dailyCloseDue(ast(2026, 11, 11, 12, 45), morning)).toBe(true)
    // the 12:45 check was missed: the 12:52 one does it
    expect(dailyCloseDue(ast(2026, 11, 11, 12, 52), morning)).toBe(true)
    // done at 12:52: not again at 13:07 or overnight, again the next day
    const done = ast(2026, 11, 11, 12, 52)
    expect(dailyCloseDue(ast(2026, 11, 11, 13, 7), done)).toBe(false)
    expect(dailyCloseDue(ast(2026, 11, 12, 2, 0), done)).toBe(false)
    expect(dailyCloseDue(ast(2026, 11, 12, 12, 45), done)).toBe(true)
    // Friday's close done: nothing on the weekend
    expect(dailyCloseDue(ast(2026, 11, 14, 12, 45), ast(2026, 11, 13, 12, 45))).toBe(false)
  })

  const trade = (over: Partial<LiveTrade> = {}): LiveTrade => ({
    market: 'GBP-USD',
    direction: 'long',
    signalTime: 1,
    entryTime: ast(2026, 11, 11, 9, 0),
    entryBucket: ast(2026, 11, 11, 9, 0),
    entry: 1.3,
    stop: 1.29,
    takeProfit: 1.32,
    units: 20_000,
    usdPerQuote: 1,
    margin: 866.67,
    entryFee: 1.82,
    ...over,
  })
  const race = () => {
    const st = createRaceState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      10_000,
      0,
    )
    st.strategies.a.open = [trade()]
    st.strategies.b.open = [
      trade({ market: 'pax-gold', entry: 4000, stop: 3950, takeProfit: 4100, units: 4 }),
    ]
    st.prices = { 'GBP-USD': 1.305, 'pax-gold': 4010 }
    st.dailyCloseAt = ast(2026, 11, 11, 2, 0)
    return st
  }
  const fee = () => 0.00007

  it('a check at 12:52 closes every account at that check price, reason session, both fees', () => {
    const r = applyDailyClose(race(), ast(2026, 11, 11, 12, 52), fee)
    expect(r.closed.map((c) => [c.strategy, c.market, c.reason, c.exit])).toEqual([
      ['A', 'GBP-USD', 'session', 1.305],
      ['B', 'pax-gold', 'session', 4010],
    ])
    const gbp = r.closed[0]
    // 20,000 x 0.005 = $100, minus the entry fee and an exit fee of 20,000 x 1.305 x 0.007%
    expect(gbp.pnl).toBeCloseTo(100 - 1.82 - 20_000 * 1.305 * 0.00007)
    expect(r.state.strategies.a.open).toHaveLength(0)
    expect(r.state.strategies.a.balance).toBeCloseTo(10_000 + gbp.pnl)
    expect(r.state.dailyCloseAt).toBe(ast(2026, 11, 11, 12, 52))
    // the next check does nothing
    expect(applyDailyClose(r.state, ast(2026, 11, 11, 13, 7), fee).closed).toHaveLength(0)
  })

  it('before 12:45 nothing closes', () => {
    expect(applyDailyClose(race(), ast(2026, 11, 11, 12, 30), fee).closed).toHaveLength(0)
  })

  it('a race new to the rule starts counting at this check (no surprise close)', () => {
    const st = race()
    delete st.dailyCloseAt
    const r = applyDailyClose(st, ast(2026, 11, 11, 20, 0), fee)
    expect(r.closed).toHaveLength(0)
    expect(r.state.dailyCloseAt).toBe(ast(2026, 11, 11, 20, 0))
    expect(applyDailyClose(r.state, ast(2026, 11, 12, 12, 45), fee).closed).toHaveLength(2)
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
