import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { daySignals, londonMarket, planFrom, sessionFor } from '../lab/johnsLondon'
import type { NewsEvent } from '../lab/news'
import { atrSeries } from './londonBreakout'
import {
  CATCH_UP,
  entriesToday,
  feedProblem,
  JOHNS_LONDON,
  johnsLondonCheck,
  sessionClock,
  type JohnsLondonInput,
} from './johnsLondonLive'
import {
  createRaceState,
  stepStrategy,
  syncRaceState,
  type LiveTrade,
  type MarketTick,
  type RaceStrategy,
} from './live'

// ── Fixtures: Kraken-like closed 15-minute candles ───────────────────────

/** Monday 2025-11-17, UK winter: session 07:00, last entry 15:00, time exit 16:30 UTC. */
const DAY0 = Date.UTC(2025, 10, 17) / 1000
const M15 = 900
const B = 1.3
const FEE = 0.00007 // race fee per side, forex

type Bar = [number, number, number, number]
const candles = (bars: Bar[], day = DAY0): OHLCCandle[] =>
  bars.map(([open, high, low, close], n) => ({ time: day + n * M15, open, high, low, close }))
const quiet = (base: number, n: number): Bar[] =>
  Array.from({ length: n }, (_, i) =>
    i % 2 === 0
      ? [base, base + 0.0005, base - 0.0005, base + 0.0002]
      : [base + 0.0002, base + 0.0005, base - 0.0005, base],
  )
/** A SELL setup on bars 30 to 35: 1 = B + 0.0010 (bar 30), 0 = B - 0.0050 (bar 33), bar 35 reaches 0.786. */
const sellSetup = (b: number): Bar[] => [
  [b, b + 0.001, b - 0.0002, b + 0.0008],
  [b + 0.0008, b + 0.0009, b - 0.002, b - 0.0018],
  [b - 0.0018, b - 0.0017, b - 0.004, b - 0.0039],
  [b - 0.0039, b - 0.0038, b - 0.005, b - 0.0049],
  [b - 0.0049, b - 0.001, b - 0.0049, b - 0.0015],
  [b - 0.0015, b - 0.0001, b - 0.0016, b - 0.0002],
]
const mirror = ([o, h, l, c]: Bar): Bar => [2 * B - o, 2 * B - l, 2 * B - h, 2 * B - c]
const SELL_DAY: Bar[] = [...quiet(B, 30), ...sellSetup(B)]
/** The signal candle (bar 35, 08:45) closes at 09:00. */
const T = DAY0 + 36 * M15
const ONE = B + 0.001
const ZERO = B - 0.005

const input = (over: Partial<JohnsLondonInput> = {}): JohnsLondonInput => ({
  market: 'GBP-USD',
  closed: candles(SELL_DAY),
  nowSec: T + 120,
  price: B - 0.0002,
  news: [],
  seen: 0,
  todayEntries: 0,
  feeRate: FEE,
  ...over,
})

// ── The signal ────────────────────────────────────────────────────────────

describe("John's London v1 live: the signal (same code as the backtest)", () => {
  it('SELL at the close of the candle that reaches 0.786 without breaking 1', () => {
    const r = johnsLondonCheck(input())
    expect(r.signal).not.toBeNull()
    expect(r.signal!.direction).toBe('short')
    expect(r.signal!.time).toBe(DAY0 + 35 * M15)
    expect(r.signal!.entry).toBe(B - 0.0002)
    expect(r.note).toMatch(/^SELL signal on the 08:45 UTC candle/)
    // The backtest's own tracker finds the same signal on the same candles.
    const c = candles(SELL_DAY)
    const [bt] = daySignals(c, atrSeries(c, 14), sessionFor(DAY0), 2)
    expect(bt.time).toBe(r.signal!.time)
    expect(bt.one).toBeCloseTo(ONE, 10)
    expect(bt.zero).toBeCloseTo(ZERO, 10)
  })

  it('BUY is the mirror', () => {
    const r = johnsLondonCheck(
      input({ closed: candles(SELL_DAY.map(mirror)), price: 2 * B - (B - 0.0002) }),
    )
    expect(r.signal!.direction).toBe('long')
    expect(r.signal!.target1).toBeCloseTo(2 * B - ZERO, 10)
    expect(r.signal!.stop).toBeLessThan(2 * B - ONE)
  })

  it('a candle still forming is never used: no signal before the signal candle closes', () => {
    const r = johnsLondonCheck(input({ closed: candles(SELL_DAY.slice(0, 35)), nowSec: T - 60 }))
    expect(r.signal).toBeNull()
    expect(r.seen).toBeUndefined()
  })

  it('only the frozen settings k = 2 and b = 0.5, on GBP/USD and gold only', () => {
    expect(JOHNS_LONDON.k).toBe(2)
    expect(JOHNS_LONDON.b).toBe(0.5)
    expect(JOHNS_LONDON.markets).toEqual(['GBP-USD', 'pax-gold'])
  })
})

// ── Stop and targets ──────────────────────────────────────────────────────

describe("John's London v1 live: stop and targets at the price now", () => {
  it('half off at 0, the rest at -0.272; stop past 1 by half an ATR, cost floor, plan 1.5R to 2.5R', () => {
    const i = input()
    const r = johnsLondonCheck(i)
    const s = r.signal!
    expect(s.target1).toBeCloseTo(ZERO, 10)
    expect(s.takeProfit).toBeCloseTo(ZERO - 0.272 * (ONE - ZERO), 10)
    const atr = atrSeries(i.closed, 14)[35]
    expect(s.stop).toBeGreaterThanOrEqual(ONE + 0.5 * atr - 1e-12)
    const m = londonMarket('GBPUSD')
    const plan = planFrom(m, false, i.price, i.price, ONE + 0.5 * atr, s.target1!, s.takeProfit)
    if ('why' in plan) throw new Error(plan.why)
    expect(s.stop).toBeCloseTo(plan.stop, 12)
    expect(plan.rr).toBeGreaterThanOrEqual(1.5)
    expect(plan.rr).toBeLessThanOrEqual(2.5 + 1e-9)
    expect(s.stop - s.entry).toBeGreaterThanOrEqual(10 * 0.000207 - 1e-6) // 10 round trips at 1.3
  })

  it('the sizer gets the stop plus the race fee on both sides', () => {
    const r = johnsLondonCheck(input())
    const s = r.signal!
    expect(r.sizeStop).toBeCloseTo(s.stop + FEE * (s.entry + s.stop), 12)
  })

  it('no chase: a price that ran toward 0 since the signal close is passed, and the signal is used up', () => {
    const r = johnsLondonCheck(input({ price: B - 0.0009 }))
    expect(r.signal).toBeNull()
    expect(r.note).toMatch(/no chase/)
    expect(r.seen).toBe(DAY0 + 35 * M15)
  })
})

// ── Deadline and news ─────────────────────────────────────────────────────

describe("John's London v1 live: deadline and red news", () => {
  const usd = (time: number): NewsEvent => ({ time, currency: 'USD', event: 'CPI' })

  it('the deadline is the time exit, 16:30 London (16:30 UTC in UK winter)', () => {
    expect(johnsLondonCheck(input()).deadline).toBe(DAY0 + 16.5 * 3600)
  })

  it('UK summer: 15:30 UTC', () => {
    const day = Date.UTC(2025, 5, 16) / 1000 // Monday, UK summer
    const bars = [...quiet(B, 26), ...sellSetup(B)] // signal bar 31 at 07:45, closes 08:00 UTC
    const r = johnsLondonCheck(
      input({ closed: candles(bars, day), nowSec: day + 32 * M15 + 60, price: B - 0.0002 }),
    )
    expect(r.signal).not.toBeNull()
    expect(r.deadline).toBe(day + 15.5 * 3600)
  })

  it('red news later today brings the deadline to 30 minutes before it', () => {
    const r = johnsLondonCheck(input({ news: [usd(T + 4 * 3600)] }))
    expect(r.signal).not.toBeNull()
    expect(r.deadline).toBe(T + 4 * 3600 - 1800)
  })

  it('under 90 minutes to the forced close: no trade', () => {
    const r = johnsLondonCheck(input({ news: [usd(T + 110 * 60)] }))
    expect(r.signal).toBeNull()
    expect(r.note).toMatch(/under 90 minutes/)
    // Exactly 90 minutes is enough.
    expect(johnsLondonCheck(input({ news: [usd(T + 120 + 120 * 60)] })).signal).not.toBeNull()
  })

  it('inside a news block: no new trade, and closeNow closes the open one', () => {
    const r = johnsLondonCheck(input({ news: [usd(T + 600)] }))
    expect(r.signal).toBeNull()
    expect(r.closeNow).toBe(true)
    expect(johnsLondonCheck(input()).closeNow).toBe(false)
  })

  it('gold follows USD news only, GBP/USD follows GBP and USD', () => {
    const gbp: NewsEvent = { time: T + 600, currency: 'GBP', event: 'BoE' }
    expect(johnsLondonCheck(input({ news: [gbp] })).closeNow).toBe(true)
    expect(johnsLondonCheck(input({ market: 'pax-gold', news: [gbp] })).closeNow).toBe(false)
  })

  it('no news list this tick: no new trade', () => {
    const r = johnsLondonCheck(input({ news: null }))
    expect(r.signal).toBeNull()
    expect(r.note).toMatch(/no red-news list/)
  })
})

// ── One look per signal ───────────────────────────────────────────────────

describe("John's London v1 live: one look per signal, catch-up up to 4 candles", () => {
  const after = (bars: Bar[]) => candles([...SELL_DAY, ...bars])

  it('acted on up to 60 minutes after its candle closed, not later', () => {
    const late = (n: number) => after(quiet(B - 0.0006, n)) // quiet candles that neither pass 1 nor reach 0
    expect(johnsLondonCheck(input({ closed: late(3), nowSec: T + CATCH_UP })).signal).not.toBeNull()
    const r = johnsLondonCheck(input({ closed: late(4), nowSec: T + CATCH_UP + 60 }))
    expect(r.signal).toBeNull()
    expect(r.seen).toBeUndefined()
  })

  it('a signal at or before the looked-at mark is not looked at again', () => {
    const r = johnsLondonCheck(input({ seen: DAY0 + 35 * M15 }))
    expect(r.signal).toBeNull()
    expect(r.note).toBe('no new signal')
  })

  it('skipped when a closed candle since traded past 1 or reached 0', () => {
    const past1 = johnsLondonCheck(
      input({
        closed: after([[B - 0.0002, B + 0.0012, B - 0.0003, B]]),
        nowSec: T + M15 + 60,
      }),
    )
    expect(past1.signal).toBeNull()
    expect(past1.note).toMatch(/past 1/)
    expect(past1.seen).toBe(DAY0 + 35 * M15)
    const zero = johnsLondonCheck(
      input({ closed: after([[B - 0.0002, B, B - 0.0051, B - 0.003]]), nowSec: T + M15 + 60 }),
    )
    expect(zero.note).toMatch(/reached 0/)
  })

  it('at most 2 trades per market a day, counted from race.json', () => {
    const r = johnsLondonCheck(input({ todayEntries: 2 }))
    expect(r.signal).toBeNull()
    expect(r.seen).toBe(DAY0 + 35 * M15)
    expect(johnsLondonCheck(input({ todayEntries: 1 })).signal).not.toBeNull()
  })

  it('entriesToday counts a trade closed in two halves once, and only today', () => {
    const t = (entryTime: number, market = 'GBP-USD') =>
      ({ market, entryTime, part1Of: 0.5 }) as unknown as RaceStrategy['closed'][number]
    const s = {
      open: [{ market: 'GBP-USD', entryTime: T + 3600 } as LiveTrade],
      closed: [t(T), t(T), t(T, 'pax-gold'), t(T - 86_400)],
    } as RaceStrategy
    expect(entriesToday(s, 'GBP-USD', T + 7200)).toBe(2)
    expect(entriesToday(s, 'pax-gold', T + 7200)).toBe(1)
  })

  it('no trade on a weekend or before the session', () => {
    const sat = DAY0 - 2 * 86_400
    expect(johnsLondonCheck(input({ nowSec: sat + 10 * 3600 })).note).toMatch(/weekend/)
    expect(johnsLondonCheck(input({ nowSec: DAY0 + 7 * 3600 })).note).toMatch(/session starts/)
  })
})

// ── Feed checks and clock ─────────────────────────────────────────────────

describe("John's London v1 live: feed checks and the clock line", () => {
  it('a frozen feed (newest closed candle 30 minutes old or more) opens nothing and keeps the signal', () => {
    const c = candles(SELL_DAY)
    expect(feedProblem(c, T + 29 * 60)).toBeNull()
    expect(feedProblem(c, T + 30 * 60)).toMatch(/frozen/)
    const r = johnsLondonCheck(input({ nowSec: T + 30 * 60 }))
    expect(r.signal).toBeNull()
    expect(r.seen).toBeUndefined()
  })

  it('a thin feed (under 14 of the last 20 candles move) opens nothing', () => {
    const thin = [...SELL_DAY]
    for (let n = 16; n < 30; n++) thin[n] = [B, B, B, B] // 6 of the last 20 move
    const c = candles(thin)
    expect(feedProblem(c, T + 60)).toMatch(/thin/)
    expect(johnsLondonCheck(input({ closed: c })).signal).toBeNull()
  })

  it('logs the first tick of the session, LATE START when more than 15 minutes late', () => {
    const start = DAY0 + 7 * 3600
    expect(sessionClock(start - 900, start + 300)).toMatch(/^first tick .* at 07:05 UTC/)
    expect(sessionClock(start - 900, start + 300)).not.toMatch(/LATE/)
    expect(sessionClock(start - 4 * 3600, start + 4 * 3600)).toMatch(/LATE START by 240 minutes/)
    expect(sessionClock(start + 60, start + 960)).toBeNull()
    expect(sessionClock(null, start - 60)).toBeNull()
  })
})

// ── The engine changes (each off unless an account turns it on) ───────────

const bar = (time: number, o: number, h: number, l: number, c: number): OHLCCandle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
})
const account = (): RaceStrategy =>
  createRaceState([{ id: JOHNS_LONDON.id, name: JOHNS_LONDON.name }], 10_000).strategies[
    JOHNS_LONDON.id
  ]
const t0 = 1_763_370_000 - (1_763_370_000 % M15)
const mtick = (over: Partial<MarketTick> = {}): MarketTick => ({
  market: 'GBP-USD',
  signal: null,
  path: [bar(t0, 1.3, 1.3, 1.3, 1.3)],
  price: 1.3,
  usdPerQuote: 1,
  feeRate: FEE,
  leverage: 30,
  ...over,
})
/** A SELL at 1.3, stop 1.303, TP1 1.297, TP2 1.295, opened at t0 + 60 (its candle is t0). */
function openSell(over: Partial<MarketTick> = {}): RaceStrategy {
  const r = stepStrategy(
    account(),
    [
      mtick({
        signal: {
          index: 0,
          time: t0 - M15,
          direction: 'short',
          entry: 1.3,
          stop: 1.303,
          takeProfit: 1.295,
        },
        target1: 1.297,
        confirm: true,
        ...over,
      }),
    ],
    t0 + 60,
  )
  expect(r.opened).toHaveLength(1)
  return r.strategy
}
const later = (n: number) => t0 + n * M15

describe('race engine: sizing stop, 1% floor, looked-at mark', () => {
  it('sizeStop: a stop-out costs 2% of the balance with both fees', () => {
    const E = 1.3
    const stop = 1.303
    const sizeStop = stop + FEE * (E + stop)
    const s = openSell({ sizeStop })
    const r = stepStrategy(
      s,
      [mtick({ path: [bar(later(1), 1.3, 1.304, 1.299, 1.3035)] })],
      later(2),
    )
    expect(r.closed).toHaveLength(1)
    expect(r.closed[0].reason).toBe('stop')
    // Confirmed by the close: fills at the close 1.3035, worse than the stop.
    expect(r.closed[0].exit).toBe(1.3035)
    // At the stop price itself the loss is exactly 2% with fees.
    const u = s.open[0].units
    expect(u * (stop - E) + u * FEE * (E + stop)).toBeCloseTo(200, 6)
  })

  it('without sizeStop the race sizes on the stop as before', () => {
    const s = openSell()
    expect(s.open[0].units * 0.003).toBeCloseTo(200, 6)
  })

  it('minRiskPct: a trade the margin cap cut under 1% at risk is skipped', () => {
    const tight = {
      signal: {
        index: 0,
        time: t0 - M15,
        direction: 'short' as const,
        entry: 1.3,
        stop: 1.3002,
        takeProfit: 1.299,
      },
    }
    const cut = stepStrategy(account(), [mtick({ ...tight, minRiskPct: 1 })], t0 + 60)
    expect(cut.opened).toHaveLength(0)
    expect(cut.passed[0].reason).toMatch(/under 1% at risk/)
    expect(cut.strategy.lastSignal['GBP-USD']).toBe(t0 - M15)
    expect(stepStrategy(account(), [mtick(tight)], t0 + 60).opened).toHaveLength(1)
  })

  it('seen moves the mark with no trade; a signal handed over still opens', () => {
    const r = stepStrategy(account(), [mtick({ seen: t0 - M15 })], t0 + 60)
    expect(r.strategy.lastSignal['GBP-USD']).toBe(t0 - M15)
    expect(r.opened).toHaveLength(0)
  })
})

describe('race engine: confirmed exits (lone-wick rule, GBP/USD only)', () => {
  it('a lone wick through the stop is ignored and reported', () => {
    const s = openSell()
    const path = [
      bar(later(1), 1.3, 1.3035, 1.2995, 1.3005), // reaches the stop, closes back under
      bar(later(2), 1.3005, 1.301, 1.2995, 1.3), // does not reach it
    ]
    const r = stepStrategy(s, [mtick({ path })], later(3))
    expect(r.closed).toHaveLength(0)
    expect(r.strategy.open).toHaveLength(1)
    expect(r.wicks).toEqual([
      { market: 'GBP-USD', level: 'stop', price: 1.303, time: later(1), next: later(2) },
    ])
  })

  it('the next candle confirms: fills at its open or the stop, whichever is worse', () => {
    const s = openSell()
    const path = [
      bar(later(1), 1.3, 1.3035, 1.2995, 1.3005),
      bar(later(2), 1.304, 1.3045, 1.302, 1.3025), // opens over the stop
    ]
    const r = stepStrategy(s, [mtick({ path })], later(3))
    expect(r.closed[0].reason).toBe('stop')
    expect(r.closed[0].exit).toBe(1.304)
    expect(r.closed[0].exitTime).toBe(later(2))
    const path2 = [path[0], bar(later(2), 1.302, 1.3031, 1.3015, 1.302)]
    expect(stepStrategy(s, [mtick({ path: path2 })], later(3)).closed[0].exit).toBe(1.303)
  })

  it('a reach on the newest closed candle waits for the next one', () => {
    const s = openSell()
    const r = stepStrategy(
      s,
      [mtick({ path: [bar(later(1), 1.3, 1.3035, 1.2995, 1.3005)] })],
      later(2),
    )
    expect(r.closed).toHaveLength(0)
    expect(r.wicks).toHaveLength(0)
  })

  it('targets follow the rule too, and fill at the target price', () => {
    const s = openSell()
    const lone = [
      bar(later(1), 1.3, 1.3005, 1.2965, 1.2985), // wick to TP1, closes back
      bar(later(2), 1.2985, 1.299, 1.2975, 1.298),
    ]
    const r1 = stepStrategy(s, [mtick({ path: lone })], later(3))
    expect(r1.closed).toHaveLength(0)
    expect(r1.wicks.map((w) => w.level)).toEqual(['TP1'])
    const confirmed = [
      bar(later(1), 1.3, 1.3005, 1.2965, 1.2968), // closes past TP1
      bar(later(2), 1.2968, 1.297, 1.2945, 1.2948), // closes past TP2
    ]
    const r2 = stepStrategy(s, [mtick({ path: confirmed })], later(3))
    expect(r2.closed.map((c) => [c.exit, c.part1Of ?? 1])).toEqual([
      [1.297, 0.5],
      [1.295, 1],
    ])
  })

  it('a confirmed stop beats a target on the same candle', () => {
    const s = openSell()
    const both = [bar(later(1), 1.3, 1.3035, 1.2965, 1.3032)]
    const r = stepStrategy(s, [mtick({ path: both })], later(2))
    expect(r.closed.map((c) => c.reason)).toEqual(['stop'])
  })

  it('the deadline comes first: a candle starting at or after it closes at its open', () => {
    const s = openSell({ deadline: later(2) })
    const path = [
      bar(later(1), 1.3, 1.3035, 1.2995, 1.3005),
      bar(later(2), 1.3008, 1.304, 1.3, 1.3035),
    ]
    const r = stepStrategy(s, [mtick({ path })], later(3))
    expect(r.closed[0].reason).toBe('time')
    expect(r.closed[0].exit).toBe(1.3008)
  })

  it('gold (no confirm flag) still fills on a plain touch', () => {
    const s = openSell({ market: 'pax-gold', confirm: false })
    expect(s.open[0].confirm).toBeUndefined()
    const r = stepStrategy(
      s,
      [mtick({ market: 'pax-gold', path: [bar(later(1), 1.3, 1.3035, 1.2995, 1.3005)] })],
      later(2),
    )
    expect(r.closed[0].reason).toBe('stop')
    expect(r.closed[0].exit).toBe(1.303)
  })
})

describe("John's London v1 joins the race", () => {
  it('as one new account with $10,000; every other account stays as it was', () => {
    const before = createRaceState(
      [
        { id: 'london-breakout', name: 'London breakout' },
        { id: 'lab-fib-eurusd-4h', name: "Lab: John's Fib, EUR/USD 4h" },
      ],
      10_000,
    )
    before.strategies['london-breakout'].balance = 9_876.5
    const { state, changes } = syncRaceState(before, [
      { id: 'london-breakout', name: 'London breakout' },
      { id: 'lab-fib-eurusd-4h', name: "Lab: John's Fib, EUR/USD 4h" },
      { id: JOHNS_LONDON.id, name: JOHNS_LONDON.name },
    ])
    expect(changes).toEqual(["John's London v1 joined the race"])
    expect(state.strategies[JOHNS_LONDON.id]).toMatchObject({
      balance: 10_000,
      open: [],
      closed: [],
    })
    expect(state.strategies['london-breakout']).toEqual(before.strategies['london-breakout'])
    expect(state.strategies['lab-fib-eurusd-4h']).toEqual(before.strategies['lab-fib-eurusd-4h'])
  })
})
