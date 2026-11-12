import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import { findSignals, JM, prepareJm } from '../lab/johnsMethod'
import { nyCloseBars } from '../lab/load'
import { NOT_LIVE } from './account'
import { closedOnly } from './candles'
import { liveStats, PAST_TESTS } from './compare'
import {
  FILL_WAIT,
  holdDeadline,
  HOLD,
  jmSignals,
  JOHNS_METHOD,
  stepJohnsMethod,
  WARMUP,
  type JmMarketInput,
} from './johnsMethodLive'
import {
  applyDailyClose,
  createRaceState,
  syncRaceState,
  tradeRisk,
  type LiveTrade,
  type RaceStrategy,
} from './live'

// ── Fixture: synthetic EUR/USD 1-hour candles ─────────────────────────────
// Monday 2025-11-03 22:00 UTC is 17:00 New York (winter time): a 4-hour
// boundary. 40 quiet 4-hour blocks, then a SELL move on the 4-hour (x up,
// y and j down: 1 = open of y = B + 0.0008, 0 = B - 0.02), then six 1-hour
// pullback candles and the signal candle that reaches 0.786.

const H = 3600
const T0 = Date.UTC(2025, 10, 3, 22) / 1000
const B = 1.1
const FEE = 0.00007 // the race's forex fee per side
type Bar = [number, number, number, number]

/** One 4-hour block as four 1-hour candles with the same open, high, low and close. */
function block([o, h, l, c]: Bar): Bar[] {
  const up = c >= o
  const [a, b] = up ? [l, h] : [h, l]
  const mid = (a + b) / 2
  return [
    [o, Math.max(o, a), Math.min(o, a), a],
    [a, Math.max(a, mid), Math.min(a, mid), mid],
    [mid, Math.max(mid, b), Math.min(mid, b), b],
    [b, Math.max(b, c), Math.min(b, c), c],
  ]
}
const quiet = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) =>
    i % 2
      ? [B + 0.0002, B + 0.001, B - 0.001, B - 0.0002]
      : [B - 0.0002, B + 0.001, B - 0.001, B + 0.0002],
  )
const MOVE: Bar[] = [
  [B - 0.0002, B + 0.0009, B - 0.0005, B + 0.0008], // x: the last up candle
  [B + 0.0008, B + 0.0009, B - 0.0082, B - 0.008], // y: 1 = its open
  [B - 0.008, B - 0.0078, B - 0.02, B - 0.019], // j: 0 = its low
]
const PULLBACK: Bar[] = [
  [B - 0.019, B - 0.0163, B - 0.0191, B - 0.0165],
  [B - 0.0165, B - 0.0138, B - 0.0166, B - 0.014],
  [B - 0.014, B - 0.0113, B - 0.0141, B - 0.0115],
  [B - 0.0115, B - 0.0088, B - 0.0116, B - 0.009],
  [B - 0.009, B - 0.0063, B - 0.0091, B - 0.0065],
  [B - 0.0065, B - 0.0049, B - 0.0066, B - 0.005],
]
/** Reaches 0.786 (B - 0.00365), stays under 0.886 (B - 0.00157) and 1. */
const SIGNAL: Bar = [B - 0.005, B - 0.0035, B - 0.0051, B - 0.004]
const BASE: Bar[] = [...[...quiet(40), ...MOVE].flatMap(block), ...PULLBACK, SIGNAL]
const toCandles = (bars: Bar[]): OHLCCandle[] =>
  bars.map(([open, high, low, close], n) => ({ time: T0 + n * H, open, high, low, close }))
/** The signal candle's start and close. */
const SIG_TIME = T0 + (BASE.length - 1) * H
const T = SIG_TIME + H
const ONE = B + 0.0008
const ZERO = B - 0.02

const input = (bars: Bar[], price: number): JmMarketInput => {
  const c = toCandles(bars)
  return {
    market: 'EUR-USD',
    h1: c,
    path: c,
    price,
    usdPerQuote: 1,
    feeRate: FEE,
    leverage: 30,
  }
}
const fresh = (): RaceStrategy =>
  createRaceState([{ id: JOHNS_METHOD.id, name: JOHNS_METHOD.name }], 10_000).strategies[
    JOHNS_METHOD.id
  ]
/** Risk of a part to its stop with both race fees, as the sizer counts it. */
const riskWithFees = (t: LiveTrade, stop = t.stop) =>
  t.units * (Math.abs(t.entry - stop) + FEE * (t.entry + stop)) * t.usdPerQuote

/** The account after half 1 opened, 7 minutes after the signal candle closed. */
function afterEntry() {
  const r = stepJohnsMethod(fresh(), [input(BASE, B - 0.004)], T + 420)
  expect(r.opened).toHaveLength(1)
  return r.strategy
}

describe("John's Method live: the account", () => {
  it('is one quiet Lab account on the markets the race prices live', () => {
    expect(JOHNS_METHOD.name.startsWith('Lab: ')).toBe(true)
    expect(JOHNS_METHOD.markets).toEqual([
      'EUR-USD',
      'GBP-USD',
      'AUD-USD',
      'USD-CHF',
      'USD-CAD',
      'pax-gold',
    ])
    for (const m of NOT_LIVE) expect(JOHNS_METHOD.markets).not.toContain(m)
    expect([JOHNS_METHOD.pair, JOHNS_METHOD.expiry, JOHNS_METHOD.sizing]).toEqual([
      'H4H1',
      'X1',
      'C',
    ])
    expect(PAST_TESTS[JOHNS_METHOD.id].evidence).toBe('lost')
  })

  it('joins a running race with $10,000 and a join time, nothing else changes', () => {
    const before = createRaceState([{ id: 'a', name: 'A' }], 10_000, 1)
    before.strategies.a.balance = 9_000
    const { state, changes } = syncRaceState(
      before,
      [
        { id: 'a', name: 'A' },
        { id: JOHNS_METHOD.id, name: JOHNS_METHOD.name },
      ],
      5_000,
    )
    expect(changes).toEqual([`${JOHNS_METHOD.name} joined the race`])
    expect(state.strategies[JOHNS_METHOD.id]).toMatchObject({ balance: 10_000, joinedAt: 5_000 })
    expect(state.strategies.a).toEqual(before.strategies.a)
  })
})

describe("John's Method live: the signal (the backtest's own tracker)", () => {
  it('finds the SELL at the close of the 1-hour candle that reaches 0.786', () => {
    const sigs = jmSignals('EUR-USD', toCandles(BASE), T + 420)
    expect(sigs).toHaveLength(1)
    const s = sigs[0]
    expect(s).toMatchObject({ long: false, sigTime: SIG_TIME, T, one: ONE, zero: ZERO })
    expect(s.tp1).toBe(ZERO)
    expect(s.tp2).toBeCloseTo(ZERO - 0.272 * (ONE - ZERO), 12)
    // Stop past 1 by half a 4-hour ATR (or the cost floor).
    expect(s.S).toBeGreaterThan(ONE)
    // The same signal as the backtest started at the same time.
    const d = prepareJm('EURUSD', toCandles(BASE), nyCloseBars)
    const bt = findSignals({ d, pair: 'H4H1', expiry: 'X1', from: T0 + WARMUP, to: T + 420 })
    expect(bt.signals.map((x) => [x.sigTime, x.one, x.zero, x.S])).toEqual([
      [s.sigTime, s.one, s.zero, s.S],
    ])
  })

  it('reads closed candles only: no signal before the signal candle closes', () => {
    const c = toCandles(BASE)
    expect(jmSignals('EUR-USD', closedOnly(c, 1, T - 1), T - 1)).toEqual([])
  })
})

describe("John's Method live: half 1", () => {
  it('opens half 1 at the price now: 1% of the balance to S, half at 0, the rest at -0.272', () => {
    const r = stepJohnsMethod(fresh(), [input(BASE, B - 0.004)], T + 420)
    const [t] = r.opened
    const sig = jmSignals('EUR-USD', toCandles(BASE), T + 420)[0]
    expect(t).toMatchObject({
      market: 'EUR-USD',
      direction: 'short',
      signalTime: SIG_TIME,
      entryTime: T + 420,
      entry: B - 0.004,
      stop: sig.S,
      target1: ZERO,
      part1: 0.5,
      takeProfit: sig.tp2,
    })
    expect(t.jm).toMatchObject({
      part: 'half1',
      half2: 'none',
      add: 'none',
      ladder: 'alive',
      fillHour: T,
    })
    expect(riskWithFees(t)).toBeCloseTo(100, 6)
    expect(r.strategy.lastSignal['EUR-USD']).toBe(SIG_TIME)
    expect(r.notes[0].note).toMatch(/SELL signal .* half 1 opened/)
  })

  it('looks once: the same signal never opens a second trade', () => {
    const s = afterEntry()
    const again = stepJohnsMethod({ ...s, open: [] }, [input(BASE, B - 0.004)], T + 1800)
    expect(again.opened).toEqual([])
  })

  it('a signal older than 2 hours is not acted on', () => {
    const r = stepJohnsMethod(fresh(), [input(BASE, B - 0.004)], T + FILL_WAIT + 60)
    expect(r.opened).toEqual([])
  })

  it('both halves go in together when the signal candle reached 0.886', () => {
    const deep: Bar = [B - 0.005, B - 0.0014, B - 0.0051, B - 0.004]
    const r = stepJohnsMethod(fresh(), [input([...BASE.slice(0, -1), deep], B - 0.004)], T + 420)
    expect(r.opened).toHaveLength(1)
    expect(r.opened[0].jm).toMatchObject({ part: 'both', half2: 'together' })
    expect(riskWithFees(r.opened[0])).toBeCloseTo(200, 6)
  })

  it('keeps the checks of the spec: no chase, plan at least 1.5R', () => {
    const chased = stepJohnsMethod(fresh(), [input(BASE, B - 0.01)], T + 420)
    expect(chased.opened).toEqual([])
    expect(chased.passed[0].reason).toMatch(/no chase|plan/)
  })

  it('the forex weekend stops new trades', () => {
    const r = stepJohnsMethod(fresh(), [input(BASE, B - 0.004)], T + 420, 'closed for the weekend')
    expect(r.opened).toEqual([])
    expect(r.passed[0].reason).toMatch(/closed for the weekend/)
  })

  it('never both sides of the dollar, and the race rules for new trades', () => {
    // An open USD/CHF short bets the dollar falls; this EUR/USD short bets it rises.
    const s = fresh()
    const chf: LiveTrade = {
      market: 'USD-CHF',
      direction: 'short',
      signalTime: 1,
      entryTime: 1,
      entryBucket: 1,
      entry: 0.8,
      stop: 0.81,
      takeProfit: 0.78,
      units: 1000,
      usdPerQuote: 1.25,
      margin: 30,
      entryFee: 0,
    }
    const r = stepJohnsMethod({ ...s, open: [chf] }, [input(BASE, B - 0.004)], T + 420)
    expect(r.opened).toEqual([])
    expect(r.passed[0].reason).toMatch(/never both sides of the dollar/)
  })
})

describe("John's Method live: the ladder", () => {
  it('half 2 opens at the next check after a candle reaches 0.886, 1% more to the same stop', () => {
    const s = afterEntry()
    const reach: Bar = [B - 0.004, B - 0.0014, B - 0.0042, B - 0.003]
    const r = stepJohnsMethod(s, [input([...BASE, reach], B - 0.003)], T + H + 420)
    expect(r.opened).toHaveLength(1)
    const h2 = r.opened[0]
    expect(h2.jm?.part).toBe('half2')
    expect(h2.stop).toBe(s.open[0].stop)
    expect(riskWithFees(h2)).toBeCloseTo(100, 6)
    expect(r.strategy.open.map((t) => t.jm?.half2)).toEqual(['filled', 'filled'])
    // One look: the next check does not open it again.
    const again = stepJohnsMethod(r.strategy, [input([...BASE, reach], B - 0.003)], T + H + 1200)
    expect(again.opened).toEqual([])
  })

  it('a reach of 0.886 missed by more than 2 hours does not open half 2', () => {
    const s = afterEntry()
    const reach: Bar = [B - 0.004, B - 0.0014, B - 0.0042, B - 0.003]
    const quietOnes: Bar[] = Array.from({ length: 3 }, () => [
      B - 0.003,
      B - 0.0028,
      B - 0.0032,
      B - 0.003,
    ])
    const r = stepJohnsMethod(
      s,
      [input([...BASE, reach, ...quietOnes], B - 0.003)],
      T + 4 * H + 420,
    )
    expect(r.opened).toEqual([])
    expect(r.strategy.open[0].jm?.half2).toMatch(/^failed: missed/)
    expect(r.strategy.open[0].jm?.ladder).toBe('alive')
  })

  it('two strong candles: the double down tops the trade up to 2% and moves every stop behind the pullback', () => {
    const s = afterEntry()
    const strong: Bar[] = [
      [B - 0.004, B - 0.0039, B - 0.0062, B - 0.006],
      [B - 0.006, B - 0.0059, B - 0.0082, B - 0.008],
    ]
    const r = stepJohnsMethod(s, [input([...BASE, ...strong], B - 0.008)], T + 2 * H + 420)
    expect(r.opened).toHaveLength(1)
    const add = r.opened[0]
    expect(add.jm?.part).toBe('add')
    const S2 = add.stop
    // Behind the pullback (its high was the signal candle's), never further than S.
    expect(S2).toBeGreaterThan(SIGNAL[1])
    expect(S2).toBeLessThan(s.open[0].stop)
    expect(r.strategy.open.every((t) => t.stop === S2)).toBe(true)
    expect(r.strategy.open.map((t) => t.jm?.ladder)).toEqual([
      'over: double down',
      'over: double down',
    ])
    expect(r.strategy.open[0].jm?.half2).toBe('cancelled')
    // Capped: the whole trade risks 2% of the balance, measured to S2.
    const total = r.strategy.open.reduce((a, t) => a + riskWithFees(t, S2), 0)
    expect(total).toBeCloseTo(200, 6)
  })

  it('the ladder ends when a candle trades past 1: no half 2 after that', () => {
    const s = afterEntry()
    const past: Bar = [B - 0.004, B + 0.001, B - 0.0042, B - 0.002]
    const r = stepJohnsMethod(s, [input([...BASE, past], B - 0.002)], T + H + 420)
    expect(r.opened).toEqual([])
    expect(r.strategy.open[0].jm).toMatchObject({
      ladder: 'over: traded past 1',
      half2: 'cancelled',
    })
  })

  it('the ladder ends after 24 candles', () => {
    const s = afterEntry()
    const flat: Bar[] = Array.from({ length: 24 }, () => [
      B - 0.004,
      B - 0.0038,
      B - 0.0042,
      B - 0.004,
    ])
    const r = stepJohnsMethod(s, [input([...BASE, ...flat], B - 0.004)], T + 24 * H + 420)
    expect(r.strategy.open[0].jm?.ladder).toBe('over: 24 candles passed')
  })
})

describe("John's Method live: exits", () => {
  it('half off at 0, the rest at -0.272', () => {
    const s = afterEntry()
    const t = s.open[0]
    const down: Bar[] = [
      [B - 0.004, B - 0.0039, ZERO - 0.0001, ZERO + 0.0005],
      [ZERO + 0.0005, ZERO + 0.0006, t.takeProfit - 0.0001, t.takeProfit],
    ]
    const r = stepJohnsMethod(s, [input([...BASE, ...down], t.takeProfit)], T + 2 * H + 420)
    expect(r.closed.map((c) => [c.reason, c.exit, c.part1Of])).toEqual([
      ['target', ZERO, 0.5],
      ['target', t.takeProfit, undefined],
    ])
    expect(r.strategy.open).toEqual([])
    expect(r.strategy.balance).toBeGreaterThan(10_000)
  })

  it('the stop closes every part', () => {
    const s = afterEntry()
    const reach: Bar = [B - 0.004, B - 0.0014, B - 0.0042, B - 0.003]
    const two = stepJohnsMethod(s, [input([...BASE, reach], B - 0.003)], T + H + 420).strategy
    // The candle half 2 filled inside is not checked for it (it started before the fill), so the stop comes an hour later.
    const calm: Bar = [B - 0.003, B - 0.0028, B - 0.0032, B - 0.003]
    const up: Bar = [B - 0.003, two.open[0].stop + 0.0001, B - 0.0031, B + 0.002]
    const r = stepJohnsMethod(two, [input([...BASE, reach, calm, up], B + 0.002)], T + 3 * H + 420)
    expect(r.closed.map((c) => c.reason)).toEqual(['stop', 'stop'])
    expect(r.strategy.open).toEqual([])
    expect(r.strategy.balance).toBeLessThan(10_000)
  })

  it('the time limit: closed at the open after the 120th hourly candle from the fill', () => {
    const c = toCandles([
      ...BASE,
      ...Array.from(
        { length: HOLD + 1 },
        (): Bar => [B - 0.004, B - 0.0038, B - 0.0042, B - 0.004],
      ),
    ])
    expect(holdDeadline(c.slice(0, -2), T)).toBeUndefined()
    expect(holdDeadline(c, T)).toBe(T + HOLD * H)
    // Keep the ladder out of it: over already.
    const s = afterEntry()
    const done = {
      ...s,
      open: s.open.map((t) => ({ ...t, jm: { ...t.jm!, ladder: 'over: test' } })),
    }
    const bars: Bar[] = [
      ...BASE,
      ...Array.from(
        { length: HOLD + 1 },
        (): Bar => [B - 0.004, B - 0.0038, B - 0.0042, B - 0.004],
      ),
    ]
    const r = stepJohnsMethod(done, [input(bars, B - 0.004)], T + (HOLD + 1) * H + 420)
    expect(r.closed.map((x) => [x.reason, x.exitTime])).toEqual([['time', T + HOLD * H]])
  })

  it('the 12:45 daily close leaves the account open; Compare counts its parts as one trade', () => {
    const s = afterEntry()
    const reach: Bar = [B - 0.004, B - 0.0014, B - 0.0042, B - 0.003]
    const two = stepJohnsMethod(s, [input([...BASE, reach], B - 0.003)], T + H + 420).strategy
    const state = {
      ...createRaceState([{ id: JOHNS_METHOD.id, name: JOHNS_METHOD.name }], 10_000),
      dailyCloseAt: 0,
      prices: { 'EUR-USD': B - 0.003 },
    }
    state.strategies[JOHNS_METHOD.id] = two
    // Wednesday 2025-11-12 17:00 UTC is after 12:45 AST.
    const now = Date.UTC(2025, 10, 12, 17) / 1000
    const r = applyDailyClose(state, now, () => FEE, [JOHNS_METHOD.id])
    expect(r.closed).toEqual([])
    expect(r.state.strategies[JOHNS_METHOD.id].open).toHaveLength(2)
    const all = applyDailyClose(state, now, () => FEE)
    expect(all.closed).toHaveLength(2)
    expect(liveStats(all.state.strategies[JOHNS_METHOD.id].closed, 10_000).trades).toBe(1)
    expect(tradeRisk(two.open[0])).toBeGreaterThan(0)
    expect(JM.maxOpen).toBe(5)
  })
})
