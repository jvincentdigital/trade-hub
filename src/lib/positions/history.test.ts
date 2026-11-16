import { describe, expect, it } from 'vitest'
import { bookClose, type ClosedFundedTrade, type FundedTrade } from '@/lib/race/live'
import { candlesAround, historyTrades, scorecard } from './history'

const HOUR = 3_600

/** A long on a USD market: 10 units, entry 100, stop 90, so it risks $100. */
const trade = (entryTime: number, over: Partial<FundedTrade> = {}): FundedTrade => ({
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
  entryFee: 0,
  strategy: 'johns-london-v1',
  ...over,
})
const close = (
  t: FundedTrade,
  exit: number,
  after: number,
  reason: ClosedFundedTrade['reason'],
): ClosedFundedTrade => bookClose(t, exit, t.entryTime + after, reason, 0)

describe('historyTrades', () => {
  it('makes one trade of a half at the first target and the rest, newest first', () => {
    const half = { ...close(trade(1000, { units: 5 }), 110, HOUR, 'target'), part1Of: 0.5 }
    const rest = close(trade(1000, { units: 5 }), 120, 2 * HOUR, 'target')
    const later = close(trade(50_000), 90, HOUR, 'stop')
    const [first, second] = historyTrades([half, rest, later])
    expect(first.entryTime).toBe(50_000)
    expect(first.r).toBeCloseTo(-1)
    expect(second).toMatchObject({
      units: 10,
      exit: 120,
      tookPart: true,
      exitTime: 1000 + 2 * HOUR,
    })
    expect(second.pnl).toBeCloseTo(150)
    expect(second.r).toBeCloseTo(1.5)
  })

  it('leaves out a trade whose rest is still open', () => {
    const half = { ...close(trade(1000, { units: 5 }), 110, HOUR, 'target'), part1Of: 0.5 }
    expect(historyTrades([half], [trade(1000, { units: 5 })])).toEqual([])
  })

  it('counts the dollars a stop lost by filling past its price', () => {
    const long = close(trade(1000), 88, HOUR, 'stop')
    const short = close(
      trade(2000, { direction: 'short', stop: 110, takeProfit: 80 }),
      113,
      HOUR,
      'stop',
    )
    const atStop = close(trade(3000), 90, HOUR, 'stop')
    const byKey = Object.fromEntries(
      historyTrades([long, short, atStop]).map((t) => [t.entryTime, t]),
    )
    expect(byKey[1000].slip).toBeCloseTo(20)
    expect(byKey[1000].r).toBeCloseTo(-1.2)
    expect(byKey[2000].slip).toBeCloseTo(30)
    expect(byKey[3000].slip).toBe(0)
  })
})

describe('scorecard', () => {
  it('averages the losers apart from the winners', () => {
    const s = scorecard(
      [
        close(trade(1000), 88, HOUR, 'stop'),
        close(trade(2000), 90, HOUR, 'stop'),
        close(trade(3000), 120, HOUR, 'target'),
      ],
      10_000,
    )
    expect(s.trades).toBe(3)
    expect(s.wins).toBe(1)
    expect(s.avgLossR).toBeCloseTo(-1.1)
    expect(s.avgR).toBeCloseTo((-1.2 - 1 + 2) / 3)
  })

  it('has no average loss without a loser', () => {
    expect(scorecard([], 10_000).avgLossR).toBeNull()
  })
})

describe('candlesAround', () => {
  it('keeps a day before the entry to half a day after the exit', () => {
    const [t] = historyTrades([close(trade(100 * HOUR), 90, 4 * HOUR, 'stop')])
    const candles = [50, 76, 100, 104, 116, 117].map((h) => ({
      time: h * HOUR,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
    }))
    expect(candlesAround(candles, t).map((c) => c.time / HOUR)).toEqual([76, 100, 104, 116])
  })
})
