import { describe, expect, it } from 'vitest'
import {
  closedTrades,
  ifAllHit,
  measure,
  periodStarts,
  racePositions,
  settledSoFar,
  sortPositions,
  tally,
  type OpenPosition,
} from './positions'
import { createAccount } from '../paper/engine'
import { createRaceState, summarize } from '../race/live'

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
  const state = createRaceState([{ id: 'r1', name: 'Rule one' }], 1000, 0)
  const open = {
    market: 'bitcoin',
    direction: 'long' as const,
    signalTime: 1,
    entryTime: 100,
    entryBucket: 90,
    entry: 50,
    stop: 45,
    takeProfit: 60,
    units: 0.2,
    usdPerQuote: 1,
    margin: 10,
    entryFee: 0.01,
  }
  state.strategies.r1.open = [open]

  it('race trades keep their units and quote rate, so P&L matches openPnl', () => {
    const [p] = racePositions(state)
    expect(p.by).toBe('Rule one')
    expect(p.openedAt).toBe(100_000)
    expect(p.units).toBe(0.2)
    expect(measure(p, 55).pnl).toBeCloseTo(1) // 0.2 x $5
  })

  it('header totals: every target hit and every stop hit', () => {
    const rows = [
      measure(long, 105),
      measure({ ...long, side: 'short', stop: 110, target: 80 }, 95),
      measure({ ...long, stop: undefined }, 101),
    ]
    // targets +40 +40, stops -20 -20; the one without a stop is left out of both
    expect(ifAllHit(rows)).toEqual({ target: 80, stop: -40, unknown: 1 })
  })

  it('closed trades merge, newest first, and tally wins and losses', () => {
    state.strategies.r1.closed.push({
      ...open,
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

describe('settledSoFar', () => {
  it('closed trades and owed entry fees: plus open P&L it is the Race tab result', () => {
    // 2026-11-11 12:01: open trades +$966 looked green while 6 closed trades had lost $1,083
    const st = createRaceState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      10_000,
      0,
    )
    st.strategies.a.balance = 10_000 - 212.27 - 212.27
    st.strategies.b.balance = 10_000
    st.strategies.b.open = [
      {
        market: 'EUR-USD',
        direction: 'short',
        signalTime: 1,
        entryTime: 2,
        entryBucket: 2,
        entry: 1.11633,
        stop: 1.12712976,
        takeProfit: 1.09413048,
        units: 18518.93,
        usdPerQuote: 1,
        margin: 689.11,
        entryFee: 1.45,
      },
    ]
    st.prices = { 'EUR-USD': 1.10948 }
    expect(settledSoFar(st)).toBeCloseTo(-424.54 - 1.45)
    const open = measure(racePositions(st)[0], 1.10948).pnl ?? 0
    expect(open).toBeCloseTo(126.85, 1)
    const raceTab = summarize(st).reduce((a, s) => a + s.pnl, 0)
    expect(settledSoFar(st) + open).toBeCloseTo(raceTab)
    expect(settledSoFar(null)).toBe(0)
  })
})
