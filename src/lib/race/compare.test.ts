import { describe, expect, it } from 'vitest'
import {
  compareRows,
  EVIDENCE_TEXT,
  JOINED_AT,
  liveStats,
  sortRows,
  tradeResults,
  type CompareRow,
} from './compare'
import { bookClose, createRaceState, type ClosedLiveTrade, type LiveTrade } from './live'

const DAY = 86_400

/** A long on a USD market: 10 units, entry 100, stop 90, so it risks $100. */
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

/** The trade closed at `exit`, both fees booked by the race's own bookClose (exit fee 0.1%). */
const closed = (entryTime: number, exit: number, over: Partial<LiveTrade> = {}): ClosedLiveTrade =>
  bookClose(trade(entryTime, over), exit, entryTime + 3600, exit > 100 ? 'target' : 'stop', 0.001)

describe('live stats from closed trades', () => {
  it('counts fees: a trade closed at its entry price is a small loss', () => {
    const [t] = tradeResults([closed(1000, 100)])
    // gross 0, entry fee $1, exit fee 10 x 100 x 0.1% = $1
    expect(t.pnl).toBeCloseTo(-2)
    expect(t.risk).toBeCloseTo(100)
    expect(t.r).toBeCloseTo(-0.02)
    const s = liveStats([closed(1000, 100)], 10_000)
    expect(s.wins).toBe(0)
    expect(s.winRate).toBe(0)
    expect(s.worstStreak).toBe(1)
  })

  it('win rate, average R and the worst losing streak, in exit order', () => {
    // win +2R, loss -1R, loss -1R, loss -1R, win +2R (before fees)
    const trades = [
      closed(1 * DAY, 120),
      closed(2 * DAY, 90),
      closed(3 * DAY, 90),
      closed(4 * DAY, 90),
      closed(5 * DAY, 120),
    ]
    const s = liveStats([...trades].reverse(), 10_000)
    expect(s.trades).toBe(5)
    expect(s.wins).toBe(2)
    expect(s.winRate).toBeCloseTo(0.4)
    expect(s.worstStreak).toBe(3)
    // Fees: $1 entry + 0.1% of the exit value; R = net / $100 risk.
    const net = (exit: number) => 10 * (exit - 100) - 1 - 10 * exit * 0.001
    const avg = (2 * net(120) + 3 * net(90)) / 5 / 100
    expect(s.avgR).toBeCloseTo(avg)
    expect(s.avgR!).toBeLessThan(0.2) // the plain +0.2R before fees
  })

  it('max drawdown from the balance after each close, as a share of the high', () => {
    const trades = [closed(1 * DAY, 120), closed(2 * DAY, 90), closed(3 * DAY, 90)]
    const s = liveStats(trades, 10_000)
    const high = 10_000 + trades[0].pnl
    const low = high + trades[1].pnl + trades[2].pnl
    expect(s.maxDrawdown).toBeCloseTo((high - low) / high)
    expect(liveStats([closed(DAY, 120)], 10_000).maxDrawdown).toBe(0)
  })

  it('a first-target half and the rest are one trade, with the whole risk', () => {
    const half = { ...closed(DAY, 110, { units: 5, entryFee: 0.5 }), part1Of: 0.5 }
    const rest = closed(DAY, 90, { units: 5, entryFee: 0.5 })
    const [t] = tradeResults([half, rest])
    expect(tradeResults([half, rest])).toHaveLength(1)
    expect(t.risk).toBeCloseTo(100)
    expect(t.pnl).toBeCloseTo(half.pnl + rest.pnl)
    expect(t.r).toBeCloseTo((half.pnl + rest.pnl) / 100)
  })

  it('leaves out a trade whose rest is still open, but its half still moves the balance', () => {
    const half = { ...closed(DAY, 110, { units: 5, entryFee: 0.5 }), part1Of: 0.5 }
    const restOpen = trade(DAY, { units: 5, entryFee: 0.5 })
    const s = liveStats([half], 10_000, [restOpen])
    expect(s.trades).toBe(0)
    expect(s.winRate).toBeNull()
    expect(s.avgR).toBeNull()
    expect(s.worstStreak).toBe(0)
  })

  it('no trades: nothing to rate', () => {
    expect(liveStats([], 10_000)).toEqual({
      trades: 0,
      wins: 0,
      winRate: null,
      avgR: null,
      worstStreak: 0,
      maxDrawdown: 0,
    })
  })
})

describe('compare rows', () => {
  const start = Date.parse('2026-11-11T04:51:21Z')
  const now = Date.parse('2026-11-14T22:00:00Z')
  const state = createRaceState(
    [
      { id: 'ema50-pullback', name: 'EMA 50 pullback' },
      { id: 'lab-rsi-us30', name: 'Lab: RSI range reversal, US30 1h' },
      { id: 'johns-london-v1', name: "John's London v1" },
    ],
    10_000,
    start,
  )
  const ema = state.strategies['ema50-pullback']
  ema.closed = [closed(1 * DAY, 120)]
  ema.balance += ema.closed[0].pnl
  ema.open = [trade(2 * DAY)]
  state.prices = { 'pax-gold': 105 }

  it('tags each strategy by its past test', () => {
    const rows = compareRows(state, now)
    const tag = (id: string) => rows.find((r) => r.id === id)!.past.evidence
    expect(tag('johns-london-v1')).toBe('passed')
    expect(tag('lab-rsi-us30')).toBe('lost')
    expect(tag('ema50-pullback')).toBe('live')
    expect(EVIDENCE_TEXT).toEqual({
      passed: 'Passed an unseen-data test',
      live: 'Testing live only',
      lost: 'Lost its past test',
    })
  })

  it('P&L adds open trades at the last price, less the entry fee they still owe', () => {
    const r = compareRows(state, now).find((x) => x.id === 'ema50-pullback')!
    expect(r.pnl).toBeCloseTo(ema.closed[0].pnl + 10 * 5 - 1)
    expect(r.stats.trades).toBe(1)
  })

  it('days live count from when the account got its money', () => {
    const rows = compareRows(state, now)
    const days = (id: string) => rows.find((r) => r.id === id)!.days
    expect(days('ema50-pullback')).toBeCloseTo((now - start) / 86_400_000)
    expect(days('lab-rsi-us30')).toBeCloseTo((now - JOINED_AT['lab-rsi-us30']) / 86_400_000)
    // A race reset after the join: the account's money is from the reset.
    const later = { ...state, startedAt: now - 86_400_000 }
    expect(compareRows(later, now).find((r) => r.id === 'lab-rsi-us30')!.days).toBeCloseTo(1)
  })
})

describe('sorting', () => {
  const row = (
    name: string,
    evidence: CompareRow['past']['evidence'],
    pnl: number,
    avgR: number | null,
    winRate: number | null,
    trades = 4,
  ): CompareRow => ({
    id: name,
    name,
    past: { evidence, text: '' },
    pnl,
    money: 10_000 + pnl,
    open: [],
    closed: [],
    stats: { trades, wins: 0, winRate, avgR, worstStreak: 0, maxDrawdown: 0 },
    since: 0,
    days: 1,
  })
  const rows = [
    row('lost-good', 'lost', 900, 0.9, 0.9),
    row('live-none', 'live', 0, null, null, 0),
    row('live-bad', 'live', -300, -0.5, 0.25),
    row('passed', 'passed', -50, -0.1, 0.5),
    row('live-good', 'live', 200, 0.4, 0.5, 6),
  ]
  const names = (key: Parameters<typeof sortRows>[1]) => sortRows(rows, key).map((r) => r.name)

  it('Evidence: passed, live only, lost; best live R first inside each; no trades last', () => {
    expect(names('evidence')).toEqual(['passed', 'live-good', 'live-bad', 'live-none', 'lost-good'])
  })
  it('Live P&L: most money first', () => {
    expect(names('pnl')).toEqual(['lost-good', 'live-good', 'live-none', 'passed', 'live-bad'])
  })
  it('Win rate: best first, more trades first on a tie, no trades last', () => {
    expect(names('winRate')).toEqual(['lost-good', 'live-good', 'passed', 'live-bad', 'live-none'])
  })
  it('does not change the rows it was given', () => {
    sortRows(rows, 'pnl')
    expect(rows[0].name).toBe('lost-good')
  })
})
