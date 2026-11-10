import { describe, expect, it } from 'vitest'
import {
  closedTrades,
  measure,
  periodStarts,
  racePositions,
  sortPositions,
  tally,
  type OpenPosition,
} from './positions'
import { createAccount } from '../paper/engine'
import { createRaceState } from '../race/live'

const long: OpenPosition = {
  key: 'a',
  source: 'demo',
  by: 'Demo',
  market: 'bitcoin',
  side: 'long',
  entry: 100,
  stop: 90,
  target: 120,
  units: 2,
  usdPerQuote: 1,
  openedAt: 0,
}

describe('measure', () => {
  it('long: P&L and distances in % and $', () => {
    const m = measure(long, 105)
    expect(m.pnl).toBeCloseTo(10)
    expect(m.pnlPct).toBeCloseTo(5)
    expect(m.toStopPct).toBeCloseTo((15 / 105) * 100)
    expect(m.toStopUsd).toBeCloseTo(30)
    expect(m.toTargetUsd).toBeCloseTo(30)
    expect(m.atStopUsd).toBeCloseTo(-20)
    expect(m.atTargetUsd).toBeCloseTo(40)
    expect(m.status).toBe('Running')
  })

  it('short: P&L sign flips', () => {
    const m = measure({ ...long, side: 'short', stop: 110, target: 80 }, 95)
    expect(m.pnl).toBeCloseTo(10)
    expect(m.atStopUsd).toBeCloseTo(-20)
    expect(m.atTargetUsd).toBeCloseTo(40)
  })

  it('status near stop / near target / no stop / no price', () => {
    expect(measure(long, 92).status).toBe('Near stop')
    expect(measure(long, 115).status).toBe('Near target')
    expect(measure({ ...long, side: 'short', stop: 110, target: 80 }, 108).status).toBe('Near stop')
    expect(measure({ ...long, stop: undefined }, 101).status).toBe('No stop')
    expect(measure(long, undefined).status).toBe('No price')
  })

  it('converts the quote currency to USD, or gives null when unknown', () => {
    expect(measure({ ...long, usdPerQuote: 0.01 }, 105).pnl).toBeCloseTo(0.1)
    expect(measure({ ...long, usdPerQuote: null }, 105).pnl).toBeNull()
  })
})

describe('race and demo rows', () => {
  const state = createRaceState([{ id: 'r1', name: 'Rule one', markets: ['bitcoin'] }], 1000, 0)
  state.strategies.r1.slots.bitcoin.open = {
    market: 'bitcoin',
    direction: 'long',
    signalTime: 1,
    entryTime: 100,
    entryBucket: 90,
    entry: 50,
    stop: 45,
    takeProfit: 60,
    notional: 10,
    entryFee: 0.01,
  }

  it('race trades: units = notional / entry, so P&L matches openPnl', () => {
    const [p] = racePositions(state)
    expect(p.by).toBe('Rule one')
    expect(p.openedAt).toBe(100_000)
    expect(measure(p, 55).pnl).toBeCloseTo(1) // 10 x 10%
  })

  it('closed trades merge, newest first, and tally wins and losses', () => {
    state.strategies.r1.closed.push({
      ...state.strategies.r1.slots.bitcoin.open!,
      exitTime: 200,
      exit: 45,
      reason: 'stop',
      pnl: -1.2,
      fees: 0.02,
    })
    const acct = createAccount(1000, 0)
    acct.history.push({
      id: 'd1',
      instrumentId: 'ethereum',
      side: 'long',
      units: 1,
      entryPrice: 10,
      margin: 10,
      entryFee: 0,
      openedAt: 0,
      exitPrice: 12,
      closedAt: 300_000,
      pnl: 2,
      reason: 'manual',
    })
    const rows = closedTrades(state, acct)
    expect(rows.map((r) => r.by)).toEqual(['Demo', 'Rule one'])
    expect(tally(rows)).toEqual({ wins: 1, losses: 1, won: 2, lost: -1.2, net: 0.8 })
  })

  it('sorts near stop first, then newest', () => {
    const rows = [
      { pos: { ...long, openedAt: 1 }, m: measure(long, 105) },
      { pos: { ...long, openedAt: 2 }, m: measure(long, 92) },
      { pos: { ...long, openedAt: 3 }, m: measure(long, 104) },
    ]
    expect(sortPositions(rows).map((r) => r.pos.openedAt)).toEqual([2, 3, 1])
  })
})

describe('periodStarts', () => {
  it('week starts 6 days before local midnight today', () => {
    const now = new Date(2026, 10, 10, 15).getTime()
    const { today, week } = periodStarts(now)
    expect(new Date(today).getHours()).toBe(0)
    expect(today - week).toBe(6 * 86_400_000)
  })
})
