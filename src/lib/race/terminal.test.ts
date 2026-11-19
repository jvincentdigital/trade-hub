import { describe, expect, it } from 'vitest'
import { bookClose, createRaceState, type LiveTrade, type RaceState } from './live'
import { createFunded } from './funded'
import {
  ALL,
  booksFor,
  candleUrl,
  changeOf,
  chartLevels,
  chartTrips,
  defaultMarket,
  footer,
  historyRows,
  openRows,
  pipsOf,
  prTime,
  priceOf,
  validAccount,
} from './terminal'
import type { OHLCCandle } from '../types/market'

const H = 3600

/** A gold buy: 10 oz, entry 100, stop 90, target 120. */
const trade = (entryTime: number, over: Partial<LiveTrade> = {}): LiveTrade => ({
  market: 'pax-gold',
  direction: 'long',
  signalTime: entryTime - 900,
  entryTime,
  entryBucket: entryTime - 900,
  entry: 100,
  stop: 90,
  takeProfit: 120,
  units: 10,
  usdPerQuote: 1,
  margin: 50,
  entryFee: 1,
  ...over,
})

function race(): RaceState {
  const s = createRaceState(
    [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ],
    1000,
  )
  s.strategies.a.open = [trade(10 * H)]
  s.strategies.b.open = [
    trade(20 * H, { market: 'EUR-USD', entry: 1.1, stop: 1.09, takeProfit: 1.12, units: 1000 }),
  ]
  s.strategies.b.balance = 1100
  s.strategies.a.closed = [bookClose(trade(2 * H), 120, 5 * H, 'target', 0)]
  s.prices = { 'pax-gold': 105, 'EUR-USD': 1.105 }
  return s
}

const candles = (from: number, n: number, step = H): OHLCCandle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: from + i * step,
    open: 100,
    high: 101,
    low: 99,
    close: 100 + i,
  }))

describe('accounts', () => {
  it('All is the strategy accounts only, not the funded tests that copy v1', () => {
    const s = race()
    s.funded = createFunded(0)
    expect(booksFor(s, ALL).map((b) => b.id)).toEqual(['a', 'b'])
    const [f] = booksFor(s, 'funded')
    expect(f.label).toBe('Funded test $10K (copies London v1)')
  })

  it('falls back to All when the saved account is gone', () => {
    expect(validAccount(race(), 'a')).toBe('a')
    expect(validAccount(race(), 'gone')).toBe(ALL)
  })
})

describe('open trades', () => {
  const live = { 'pax-gold': 110, 'EUR-USD': 1.2 }
  const s = race()
  const rows = openRows(booksFor(s, ALL), (m) => priceOf(m, live, s.prices))

  it('is newest first, prices forex at the race price and gold at the live one', () => {
    expect(rows.map((r) => r.trade.market)).toEqual(['EUR-USD', 'pax-gold'])
    expect(rows[0].price).toBe(1.105)
    expect(rows[1].price).toBe(110)
    expect(rows[1].pnl).toBeCloseTo(100)
    expect(rows[0].pips).toBeCloseTo(50)
    expect(rows[1].pips).toBeNull()
  })

  it('sums balance, equity and open P&L', () => {
    const f = footer(booksFor(s, ALL), rows)
    expect(f.balance).toBe(2100)
    expect(f.openPnl).toBeCloseTo(105)
    expect(f.equity).toBeCloseTo(2205)
    expect(f.accounts).toBe(2)
  })

  it('picks the newest open trade market for the chart, else gold', () => {
    expect(defaultMarket(rows)).toBe('EUR-USD')
    expect(defaultMarket([])).toBe('pax-gold')
  })

  it('a sell gains pips when the price falls', () => {
    expect(pipsOf({ market: 'USD-JPY', direction: 'short', entry: 150 }, 149.5)).toBeCloseTo(50)
  })
})

describe('chart lines', () => {
  it('draws entry, stop and target, two targets when it has a first target, and marks the picked trade', () => {
    const s = race()
    s.strategies.a.open = [trade(10 * H, { target1: 110, part1: 0.5 })]
    const rows = openRows(booksFor(s, 'a'), () => 105)
    const lines = chartLevels(rows, 'pax-gold', rows[0].key)
    expect(lines.map((l) => [l.kind, l.price, l.title])).toEqual([
      ['entry', 100, 'Buy'],
      ['stop', 90, 'Stop'],
      ['target', 110, 'T1'],
      ['target', 120, 'T2'],
    ])
    expect(lines.every((l) => l.picked)).toBe(true)
    expect(chartLevels(rows, 'EUR-USD', null)).toEqual([])
  })

  it('places a closed trade on the candles it entered and left, and skips one outside them', () => {
    const rows = historyRows(booksFor(race(), ALL))
    const [trip] = chartTrips(rows, 'pax-gold', candles(0, 10))
    expect(trip).toMatchObject({ entryTime: 2 * H, exitTime: 5 * H, won: true, exit: 120 })
    expect(chartTrips(rows, 'pax-gold', candles(6 * H, 10))).toEqual([])
  })
})

describe('history', () => {
  it('shows a trade closed in halves as two rows, the first one saying half', () => {
    const s = race()
    const t = trade(2 * H, { target1: 110, part1: 0.5 })
    const half = { ...bookClose({ ...t, units: 5 }, 110, 4 * H, 'target', 0), part1Of: 0.5 }
    const rest = bookClose({ ...t, units: 5 }, 90, 6 * H, 'stop', 0)
    s.strategies.a.closed = [half, rest]
    const rows = historyRows(booksFor(s, 'a'))
    expect(rows.map((r) => [r.reason, r.half])).toEqual([
      ['hit stop', false],
      ['hit first target (half)', true],
    ])
  })
})

describe('chart data', () => {
  it('has 15m to 4h candles for Kraken markets, daily only for ECB pairs, none for US30', () => {
    expect(candleUrl('pax-gold', '15m')).toEqual({
      url: '/api/crypto/candles/pax-gold?tf=15m',
      daily: false,
    })
    expect(candleUrl('GBP-JPY', '4h')?.daily).toBe(false)
    expect(candleUrl('USD-JPY', '1h')).toEqual({
      url: '/api/forex/ohlc/USD-JPY?days=90',
      daily: true,
    })
    expect(candleUrl('US30', '1h')).toBeNull()
  })

  it('measures the change against the close a day back', () => {
    const c = candles(0, 30)
    // last candle at 29h, a day back is 5h, close 105
    expect(changeOf(c, 110)).toMatchObject({ abs: 5 })
    expect(changeOf(c.slice(0, 5), 110)).toBeNull()
  })

  it('writes times in Puerto Rico time, UTC-4', () => {
    expect(prTime(Date.UTC(2026, 10, 18, 13, 15) / 1000)).toBe('Nov 18, 9:15 AM')
  })
})
