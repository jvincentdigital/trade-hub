import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import type { BacktestResult, BacktestTrade, Signal } from '../rules/engine'
import { closedOnly } from './candles'
import { backtest } from '../rules/engine'
import { BUILT_IN_RULES } from '../rules/presets'
import { rankEntries, scoreStrategy, shareOf, WINDOW_DAYS, windowStart } from './leaderboard'
import {
  createRaceState,
  raceStateSchema,
  stepSlot,
  summarize,
  syncRaceState,
  type Slot,
} from './live'

const H = 3600
const bar = (time: number, o: number, h: number, l: number, c: number): OHLCCandle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
})

describe('candles', () => {
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
      days: 90,
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
        days: 30,
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

describe('backtest windows', () => {
  it('matches the real candles Kraken keeps per size', () => {
    const now = 1_800_000_000
    expect(WINDOW_DAYS).toEqual({ '1h': 30, '4h': 120, '1d': 365 })
    expect(now - windowStart('1h', now)).toBe(30 * 86_400)
    expect(now - windowStart('4h', now)).toBe(120 * 86_400)
    expect(now - windowStart('1d', now)).toBe(365 * 86_400)
  })

  it('a 1h rule only trades inside its 30 days, and money a month uses that window', () => {
    // 60 days of zig-zag 1h candles: the rule could fire anywhere.
    const now = 1_800_000_000
    const t0 = now - 60 * 86_400
    const candles = Array.from({ length: 60 * 24 }, (_, i) => {
      const mid = 100 + 5 * Math.sin(i / 6)
      return bar(t0 + i * H, mid - 0.3, mid + 1, mid - 1, mid + 0.3)
    })
    const rule = BUILT_IN_RULES.find((r) => r.timeframe === '1h')!
    const res = backtest(rule, candles, { startEquity: 1, tradeFrom: windowStart('1h', now) })
    for (const t of res.trades) expect(t.entryTime).toBeGreaterThanOrEqual(windowStart('1h', now))
    const e = scoreStrategy({
      ruleId: rule.id,
      riskPct: 1,
      start: 1000,
      runs: [{ id: 'bitcoin', result: result([3]) }],
      skipped: [],
      days: WINDOW_DAYS['1h'],
    })
    expect(e.days).toBe(30)
    expect(e.perMonth).toBeCloseTo(e.profit)
  })
})

describe('race state migration (gold joins an existing race)', () => {
  it('adds gold to each strategy without touching open trades or total money', () => {
    const old = createRaceState(
      [
        { id: 'a', name: 'A', markets: ['bitcoin', 'ethereum'] },
        { id: 'c', name: 'C', markets: ['bitcoin'] },
      ],
      1000,
      1,
    )
    old.strategies.a.slots.bitcoin = stepSlot(old.strategies.a.slots.bitcoin, {
      ...base,
      signal: sig(),
      path: [bar(4000, 100, 100, 100, 100)],
      price: 100,
    }).slot
    old.strategies.a.closed.push({
      ...old.strategies.a.slots.bitcoin.open!,
      exitTime: 1,
      exit: 1,
      reason: 'stop',
      pnl: -1,
      fees: 0,
    })
    old.prices.bitcoin = 100
    const before = summarize(old).find((x) => x.ruleId === 'a')!.money
    const openBefore = old.strategies.a.slots.bitcoin.open

    const { state, changes } = syncRaceState(old, [
      { id: 'a', name: 'A', markets: ['bitcoin', 'ethereum', 'pax-gold'] },
      { id: 'c', name: 'C', markets: ['bitcoin'] },
      { id: 'n', name: 'New', markets: ['pax-gold'] },
    ])
    expect(raceStateSchema.safeParse(state).success).toBe(true)
    const a = state.strategies.a
    expect(a.slots['pax-gold']).toEqual({ balance: 1000 / 3, open: null, lastSignalTime: 0 })
    expect(a.slots.bitcoin.open).toEqual(openBefore)
    expect(a.closed).toHaveLength(1)
    expect(summarize(state).find((x) => x.ruleId === 'a')!.money).toBeCloseTo(before)
    // untouched strategy, and a new one starting fresh
    expect(state.strategies.c).toEqual(old.strategies.c)
    expect(state.strategies.n.slots['pax-gold'].balance).toBe(1000)
    expect(changes).toEqual(['A: added pax-gold', 'New joined the race'])
    // running it again changes nothing
    expect(
      syncRaceState(state, [{ id: 'a', name: 'A', markets: ['bitcoin', 'ethereum', 'pax-gold'] }])
        .changes,
    ).toEqual([])
  })
})
