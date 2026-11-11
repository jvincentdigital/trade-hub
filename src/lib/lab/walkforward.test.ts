import { describe, expect, it } from 'vitest'
import type { Candidate } from '../race/leaderboard'
import {
  chooseParams,
  metricsOf,
  splitSpan,
  splitTrades,
  walkForward,
  START_MONEY,
} from './walkforward'
import { portfolioBacktest } from '../race/leaderboard'

const DAY = 86_400
const T0 = Date.UTC(2025, 0, 1) / 1000

const trade = (day: number, win: boolean): Candidate => ({
  market: 'GBPUSD',
  direction: 'long',
  entryTime: T0 + day * DAY,
  exitTime: T0 + day * DAY + 3600,
  entry: 1.3,
  exit: win ? 1.32 : 1.29,
  stop: 1.29,
  takeProfit: 1.32,
  r: win ? 2 : -1,
  reason: win ? 'target' : 'stop',
  usdPerQuote: 1,
  feeRate: 0,
  leverage: 30,
  candleSec: 3600,
})

describe('walk-forward split', () => {
  it('first 70% in-sample, last 30% out-of-sample, by entry time', () => {
    const s = splitSpan(T0, T0 + 100 * DAY)
    expect(s.split).toBe(T0 + 70 * DAY)
    const { is, oos } = splitTrades(
      [trade(10, true), trade(69, true), trade(70, false), trade(99, true), trade(120, true)],
      s,
    )
    expect(is.map((t) => t.entryTime)).toEqual([T0 + 10 * DAY, T0 + 69 * DAY])
    expect(oos.map((t) => t.entryTime)).toEqual([T0 + 70 * DAY, T0 + 99 * DAY])
  })
  it('chooses parameters on in-sample money only, among sets with enough trades', () => {
    expect(
      chooseParams([
        { params: 'a', isNet: 500, isTrades: 25 },
        { params: 'b', isNet: 900, isTrades: 10 },
        { params: 'c', isNet: 700, isTrades: 40 },
      ]),
    ).toBe(2)
    expect(
      chooseParams([
        { params: 'a', isNet: 500, isTrades: 5 },
        { params: 'b', isNet: -100, isTrades: 8 },
      ]),
    ).toBe(1)
  })
  it('scores the chosen set out-of-sample in a fresh $10,000 account', () => {
    const s = splitSpan(T0, T0 + 100 * DAY)
    // "good" wins in-sample and loses out-of-sample; "bad" the other way round.
    const good = Array.from({ length: 100 }, (_, d) => trade(d, d < 70))
    const bad = Array.from({ length: 100 }, (_, d) => trade(d, d >= 70))
    const w = walkForward(s, ['bad', 'good'], (p) => (p === 'good' ? good : bad))
    expect(w.params).toBe('good')
    expect(w.is.trades).toBe(70)
    expect(w.is.net).toBeGreaterThan(0)
    expect(w.oos.trades).toBe(30)
    expect(w.oos.net).toBeLessThan(0)
    expect(w.oos.end).toBeCloseTo(START_MONEY * 0.98 ** 30, 6)
  })
  it('reports drawdown, months and average R', () => {
    const p = portfolioBacktest(START_MONEY, [trade(1, false), trade(2, true)])
    const m = metricsOf(p, T0, T0 + 30.4375 * DAY)
    expect(m.trades).toBe(2)
    expect(m.maxDrawdownPct).toBeCloseTo(2, 6)
    expect(m.months).toBeCloseTo(1, 9)
    expect(m.avgR).toBeCloseTo(0.5, 6)
    expect(m.winRate).toBe(0.5)
  })
})
