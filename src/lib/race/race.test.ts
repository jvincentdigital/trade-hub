import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import type { Signal } from '../rules/engine'
import { closedOnly } from './candles'
import { backtest } from '../rules/engine'
import { BUILT_IN_RULES } from '../rules/presets'
import {
  ALLOWED_CRYPTO,
  minStopForFullRisk,
  newTradeBlock,
  RACE_SIZING,
  sizeRaceTrade,
} from './account'
import {
  portfolioBacktest,
  rankEntries,
  scoreStrategy,
  WINDOW_DAYS,
  windowStart,
  type Candidate,
} from './leaderboard'
import {
  createRaceState,
  parseRaceState,
  raceStateSchema,
  stepStrategy,
  summarize,
  syncRaceState,
  type MarketTick,
  type RaceStrategy,
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

describe('sizing a new trade (one real account)', () => {
  const base = { balance: 1000, open: [], entry: 100, stop: 95, usdPerQuote: 1, leverage: 30 }

  it('risks 2% of the balance at the stop', () => {
    const r = sizeRaceTrade(base)
    expect(r.ok && r.units).toBeCloseTo(4)
    expect(r.ok && r.riskUsd).toBeCloseTo(20)
    expect(r.ok && r.margin).toBeCloseTo(400 / 30)
    expect(RACE_SIZING).toEqual({ riskPct: 2, maxOpen: 5, maxOpenRiskPct: 10 })
  })

  it('caps the position value at the free balance x leverage', () => {
    // 2% on a 0.1% stop would be $20,000 of spot crypto; 1:1 caps it at $1,000
    const r = sizeRaceTrade({ ...base, stop: 99.9, leverage: 1 })
    expect(r.ok && r.units).toBeCloseTo(10)
    expect(r.ok && r.capped).toBe(true)
    expect(r.ok && r.riskUsd).toBeCloseTo(1)
    // $900 already tied up in another trade leaves $100
    const tied = sizeRaceTrade({
      ...base,
      stop: 99.9,
      leverage: 1,
      open: [{ margin: 900, riskUsd: 5 }],
    })
    expect(tied.ok && tied.units).toBeCloseTo(1)
    expect(sizeRaceTrade({ ...base, leverage: 1, open: [{ margin: 1000, riskUsd: 5 }] })).toEqual({
      ok: false,
      reason: 'no free margin',
    })
  })

  it('minStopForFullRisk: the closest stop that still risks the full 2% within the margin cap', () => {
    // GBP/USD at 1.334, 30:1: 8.9 pips. A 3.6-pip stop gets cut to about 0.8% risk.
    const d = minStopForFullRisk(1.334, 30, 2)
    expect(d).toBeCloseTo(0.000889, 6)
    const gbp = { ...base, entry: 1.334, leverage: 30 }
    const full = sizeRaceTrade({ ...gbp, stop: 1.334 - d })
    expect(full.ok && full.riskUsd).toBeCloseTo(20, 6)
    const tight = sizeRaceTrade({ ...gbp, stop: 1.334 - 0.00036 })
    expect(tight.ok && tight.capped).toBe(true)
    expect(tight.ok && tight.riskUsd).toBeCloseTo(8.1, 1)
    expect(minStopForFullRisk(4000, 20, 2)).toBeCloseTo(4, 10) // gold: $4.00
  })

  it('at most 5 open, and total open risk at most 10% of the balance', () => {
    const four = Array.from({ length: 4 }, () => ({ margin: 10, riskUsd: 20 }))
    expect(sizeRaceTrade({ ...base, open: four }).ok).toBe(true)
    expect(sizeRaceTrade({ ...base, open: [...four, { margin: 10, riskUsd: 1 }] })).toEqual({
      ok: false,
      reason: '5 trades already open',
    })
    // after a $20 loss: 4 x $20 open + $19.60 new = $99.60, over 10% of $980
    expect(sizeRaceTrade({ ...base, balance: 980, open: four })).toEqual({
      ok: false,
      reason: 'open risk would pass 10%',
    })
  })
})

const sig = (over: Partial<Signal> = {}): Signal => ({
  index: 0,
  time: 1000,
  direction: 'long',
  entry: 100,
  stop: 95,
  takeProfit: 110,
  ...over,
})
const tick = (over: Partial<MarketTick> = {}): MarketTick => ({
  market: 'bitcoin',
  signal: null,
  path: [bar(4000, 100, 100, 100, 100)],
  price: 100,
  usdPerQuote: 1,
  feeRate: 0.001,
  leverage: 1,
  ...over,
})
const fresh = (): RaceStrategy => createRaceState([{ id: 'a', name: 'A' }], 1000, 1).strategies.a

describe('live forward test step', () => {
  it('opens on a new signal at 2% of the balance; fees are paid at the close', () => {
    const r = stepStrategy(fresh(), [tick({ signal: sig() })], 5000)
    const t = r.opened[0]
    // $20 at a 5% stop = 4 units of $100 = $400; the 0.1% fee (40 cents) is owed
    expect(t.units).toBeCloseTo(4)
    expect(t.margin).toBeCloseTo(400)
    expect(t.entryFee).toBeCloseTo(0.4)
    expect(t.entryBucket).toBe(4000)
    expect(r.strategy.balance).toBe(1000)
    expect(r.strategy.lastSignal.bitcoin).toBe(1000)
    // the same signal never opens twice
    const again = stepStrategy({ ...r.strategy, open: [] }, [tick({ signal: sig() })], 6000)
    expect(again.opened).toHaveLength(0)
  })

  it('skips a signal whose stop or target the price already passed', () => {
    const r = stepStrategy(fresh(), [tick({ signal: sig(), price: 111 })], 5000)
    expect(r.opened).toHaveLength(0)
    expect(r.strategy.lastSignal.bitcoin).toBe(1000)
  })

  const opened = () => stepStrategy(fresh(), [tick({ signal: sig() })], 5000).strategy

  it('closes at the target on a later candle, both fees counted', () => {
    const r = stepStrategy(
      opened(),
      // the entry candle itself is ignored even though it dipped
      [tick({ path: [bar(4000, 100, 100, 90, 100), bar(4000 + H, 100, 111, 99, 108)] })],
      9000,
    )
    expect(r.closed[0].reason).toBe('target')
    expect(r.closed[0].exit).toBe(110)
    // 4 units x $10 = $40, fees 0.40 + 0.44
    expect(r.closed[0].pnl).toBeCloseTo(40 - 0.84)
    expect(r.strategy.balance).toBeCloseTo(1000 + 40 - 0.84)
    expect(r.strategy.open).toHaveLength(0)
  })

  it('checks the stop first when a candle touches both, and fills a gap at the open', () => {
    const both = stepStrategy(opened(), [tick({ path: [bar(4000 + H, 100, 111, 94, 100)] })], 9000)
    expect(both.closed[0].reason).toBe('stop')
    expect(both.closed[0].exit).toBe(95)
    expect(both.closed[0].pnl).toBeCloseTo(-20 - 0.4 - 0.38)
    const gap = stepStrategy(opened(), [tick({ path: [bar(4000 + H, 90, 91, 89, 90)] })], 9000)
    expect(gap.closed[0].exit).toBe(90)
  })

  it('shorts make money when price falls', () => {
    const s = stepStrategy(
      fresh(),
      [tick({ signal: sig({ direction: 'short', stop: 105, takeProfit: 90 }) })],
      5000,
    ).strategy
    const r = stepStrategy(s, [tick({ path: [bar(4000 + H, 99, 99, 89, 90)] })], 9000)
    expect(r.closed[0].reason).toBe('target')
    expect(r.closed[0].pnl).toBeGreaterThan(0)
  })

  it('every market shares one balance; the 6th signal waits for a free spot', () => {
    // mixed so the dollar rule (at most 2 the same way) lets all 6 through
    const ids = ['EUR-USD', 'AUD-USD', 'USD-CAD', 'EUR-GBP', 'bitcoin', 'USD-CHF']
    const r = stepStrategy(
      fresh(),
      ids.map((market) => tick({ market, signal: sig(), leverage: 30, feeRate: 0 })),
      5000,
    )
    expect(r.opened).toHaveLength(5)
    // $20 each from the same $1,000: 4 units at a $5 stop
    for (const t of r.opened) expect(t.units).toBeCloseTo(4)
    expect(r.passed).toEqual([{ market: 'USD-CHF', reason: '5 trades already open' }])
  })

  it('no trade without a USD rate for the quote currency', () => {
    const r = stepStrategy(
      fresh(),
      [tick({ market: 'EUR-GBP', signal: sig(), usdPerQuote: null })],
      5000,
    )
    expect(r.opened).toHaveLength(0)
    expect(r.passed[0].reason).toMatch(/USD rate/)
  })

  it('summarizes money as balance + open P&L - fees still owed', () => {
    const st = createRaceState([{ id: 'a', name: 'A' }], 1000, 1)
    expect(raceStateSchema.safeParse(st).success).toBe(true)
    st.strategies.a = opened()
    st.prices.bitcoin = 105
    const [s] = summarize(st)
    // 4 units x +$5 = +$20, minus the $0.40 entry fee
    expect(s.money).toBeCloseTo(1000 + 20 - 0.4)
    expect(s.open).toHaveLength(1)
  })

  it('a market moved to smaller path candles never checks candles from before the entry', () => {
    // Opened at 5000 on a daily path (bucket 0); the path is now 15m candles.
    const s = { ...opened(), open: opened().open.map((t) => ({ ...t, entryBucket: 0 })) }
    const before = stepStrategy(s, [tick({ path: [bar(4100, 100, 100, 90, 100)] })], 9000)
    expect(before.closed).toHaveLength(0)
    const later = stepStrategy(s, [tick({ path: [bar(5400, 100, 100, 90, 100)] })], 9000)
    expect(later.closed[0].reason).toBe('stop')
  })

  it("keeps a signal's note on the trade it opens, through the close", () => {
    const r = stepStrategy(fresh(), [tick({ signal: sig(), note: 'Range break' })], 5000)
    expect(r.opened[0].note).toBe('Range break')
    const c = stepStrategy(r.strategy, [tick({ path: [bar(4000 + H, 100, 111, 99, 108)] })], 9000)
    expect(c.closed[0].note).toBe('Range break')
    expect(raceStateSchema.shape.strategies.safeParse({ a: c.strategy }).success).toBe(true)
  })

  it('a new built-in strategy joins with fresh money; running again changes nothing', () => {
    const st = createRaceState([{ id: 'a', name: 'A' }], 1000, 1)
    st.strategies.a = opened()
    const { state, changes } = syncRaceState(st, [
      { id: 'a', name: 'A' },
      { id: 'n', name: 'New' },
    ])
    expect(changes).toEqual(['New joined the race'])
    expect(state.strategies.a).toEqual(st.strategies.a)
    expect(state.strategies.n.balance).toBe(1000)
    expect(syncRaceState(state, [{ id: 'n', name: 'New' }]).changes).toEqual([])
  })
})

describe('rules for new trades (John, 2026-11-11)', () => {
  const fx = (market: string, direction: 'long' | 'short' = 'long') =>
    tick({
      market,
      leverage: 30,
      feeRate: 0,
      signal: direction === 'long' ? sig() : sig({ direction: 'short', stop: 105, takeProfit: 90 }),
    })
  /** An account with these trades already open (opened before the rules, if need be). */
  const holding = (...trades: [string, 'long' | 'short'][]): RaceStrategy => {
    const [t] = stepStrategy(fresh(), [tick({ signal: sig() })], 5000).strategy.open
    return {
      ...fresh(),
      open: trades.map(([market, direction]) => ({ ...t, market, direction })),
    }
  }
  const step = (s: RaceStrategy, ticks: MarketTick[]) => stepStrategy(s, ticks, 5000)

  it('no new crypto except Bitcoin; gold and forex as before', () => {
    const r = step(fresh(), [
      tick({ market: 'binancecoin', signal: sig() }),
      tick({ market: 'polygon-ecosystem-token', signal: sig() }),
      tick({ market: 'bitcoin', signal: sig() }),
    ])
    expect(r.opened.map((t) => t.market)).toEqual(['bitcoin'])
    expect(r.passed).toEqual([
      { market: 'binancecoin', reason: 'no new crypto trades except Bitcoin' },
      { market: 'polygon-ecosystem-token', reason: 'no new crypto trades except Bitcoin' },
    ])
    // the refused signal is used up, like any other PASS
    expect(r.strategy.lastSignal.binancecoin).toBe(1000)
    expect(ALLOWED_CRYPTO).toEqual(['bitcoin'])
    const other = step(fresh(), [fx('pax-gold'), fx('EUR-USD', 'short')])
    expect(other.opened.map((t) => t.market)).toEqual(['pax-gold', 'EUR-USD'])
  })

  it('an open BNB trade keeps running and still closes at its stop', () => {
    const s = holding(['binancecoin', 'long'])
    const quiet = stepStrategy(
      s,
      [tick({ market: 'binancecoin', path: [bar(4000 + H, 100, 101, 99, 100)] })],
      9000,
    )
    expect(quiet.strategy.open).toHaveLength(1)
    const hit = stepStrategy(
      s,
      [tick({ market: 'binancecoin', path: [bar(4000 + H, 100, 100, 94, 96)] })],
      9000,
    )
    expect(hit.closed[0]).toMatchObject({ market: 'binancecoin', reason: 'stop', exit: 95 })
    expect(hit.closed[0].pnl).toBeCloseTo(-20 - 0.4 - 0.38)
    expect(hit.strategy.open).toHaveLength(0)
  })

  it('never opposite sides of the pound/dollar bet in one account', () => {
    const s = holding(['GBP-USD', 'long'])
    const r = step(s, [fx('pax-gold', 'short'), fx('EUR-GBP', 'long')])
    expect(r.opened).toHaveLength(0)
    expect(r.passed).toEqual([
      {
        market: 'pax-gold',
        reason: 'against the open GBP-USD long (one pound/dollar bet per account)',
      },
      {
        market: 'EUR-GBP',
        reason: 'against the open GBP-USD long (one pound/dollar bet per account)',
      },
    ])
    // the same way is fine: gold long and EUR/GBP short are both "dollar down / pound up"
    expect(step(s, [fx('pax-gold', 'long')]).opened).toHaveLength(1)
    expect(step(s, [fx('EUR-GBP', 'short')]).opened).toHaveLength(1)
    // a market outside the group is not affected
    expect(step(s, [fx('EUR-USD', 'short')]).opened).toHaveLength(1)
  })

  it('at most 2 the same way', () => {
    const r = step(holding(['GBP-USD', 'long'], ['pax-gold', 'long']), [fx('EUR-GBP', 'short')])
    expect(r.opened).toHaveLength(0)
    expect(r.passed[0].reason).toBe('2 pound/dollar trades already open the same way')
    // also inside one tick: the third signal of the tick waits
    const one = step(fresh(), [fx('GBP-USD'), fx('pax-gold'), fx('EUR-GBP', 'short')])
    expect(one.opened.map((t) => t.market)).toEqual(['GBP-USD', 'pax-gold'])
  })

  it('GBP/JPY is a copy of GBP/USD: never both open in one account', () => {
    // the 2026-11-11 case: both signalled on the same tick
    const r = step(fresh(), [fx('GBP-USD'), fx('GBP-JPY')])
    expect(r.opened.map((t) => t.market)).toEqual(['GBP-USD'])
    expect(r.passed).toEqual([
      {
        market: 'GBP-JPY',
        reason: 'GBP-JPY is a copy of the open GBP-USD trade (one pound/dollar bet per account)',
      },
    ])
    expect(step(holding(['GBP-JPY', 'short']), [fx('GBP-USD', 'short')]).passed[0].reason).toMatch(
      /GBP-USD is a copy of the open GBP-JPY/,
    )
    // GBP/JPY with gold the same way is one bet, two trades: fine
    expect(step(holding(['pax-gold', 'long']), [fx('GBP-JPY')]).opened).toHaveLength(1)
  })

  it('other accounts may disagree; trades already open are not touched', () => {
    const a = step(holding(['GBP-USD', 'long']), [fx('pax-gold', 'short')])
    const b = step(fresh(), [fx('pax-gold', 'short')])
    expect(a.opened).toHaveLength(0)
    expect(b.opened.map((t) => `${t.market} ${t.direction}`)).toEqual(['pax-gold short'])
    // an account already holding both sides keeps both until they close
    const mixed = holding(['GBP-USD', 'long'], ['pax-gold', 'short'], ['GBP-JPY', 'long'])
    const kept = step(mixed, [tick({ market: 'GBP-USD' }), tick({ market: 'pax-gold' })])
    expect(kept.strategy.open).toEqual(mixed.open)
  })

  it('at most 2 bets the same way on the dollar', () => {
    // the 2026-11-11 12:00 case: EUR/USD long and USD/CHF short open, GBP/USD long next
    const r = step(holding(['EUR-USD', 'long'], ['USD-CHF', 'short']), [fx('GBP-USD')])
    expect(r.opened).toHaveLength(0)
    expect(r.passed).toEqual([
      { market: 'GBP-USD', reason: '2 trades already bet the dollar falls' },
    ])
    // the other way: EMA 50's short EUR/USD + long USD/JPY, then gold short
    expect(
      step(holding(['EUR-USD', 'short'], ['USD-JPY', 'long']), [fx('pax-gold', 'short')]).passed[0]
        .reason,
    ).toBe('2 trades already bet the dollar rises')
    // inside one tick: the third dollar-down signal waits
    const one = step(fresh(), [fx('EUR-USD'), fx('AUD-USD'), fx('USD-CAD', 'short')])
    expect(one.opened.map((t) => t.market)).toEqual(['EUR-USD', 'AUD-USD'])
    // opposite dollar bets are fine, and so are markets without the dollar
    expect(
      step(holding(['EUR-USD', 'long'], ['AUD-USD', 'long']), [fx('USD-CHF')]).opened,
    ).toHaveLength(1)
    expect(
      step(holding(['EUR-USD', 'long'], ['AUD-USD', 'long']), [fx('EUR-GBP')]).opened,
    ).toHaveLength(1)
  })

  it('newTradeBlock on its own', () => {
    expect(newTradeBlock({ market: 'bitcoin', direction: 'short' }, [])).toBeNull()
    expect(newTradeBlock({ market: 'ethereum', direction: 'long' }, [])).toMatch(/except Bitcoin/)
    expect(newTradeBlock({ market: 'GBP-USD', direction: 'long' }, [])).toBeNull()
  })
})

describe('old race files (money split per market) move to the one-account layout', () => {
  const trade = (market: string, entry: number, notional: number) => ({
    market,
    direction: 'long' as const,
    signalTime: 1,
    entryTime: 2,
    entryBucket: 2,
    entry,
    stop: entry * 0.99,
    takeProfit: entry * 1.02,
    notional,
    entryFee: notional * 0.001,
  })
  const legacy = {
    version: 1,
    startedAt: 1,
    startMoney: 1000,
    tickCount: 6,
    ticks: [],
    prices: { bitcoin: 101, 'USD-JPY': 160, 'GBP-USD': 1.34 },
    strategies: {
      a: {
        ruleId: 'a',
        name: 'A',
        slots: {
          bitcoin: { balance: 499.9, open: trade('bitcoin', 100, 100), lastSignalTime: 7 },
          'USD-JPY': { balance: 500, open: trade('USD-JPY', 158, 50), lastSignalTime: 8 },
          ethereum: { balance: 1.5, open: null, lastSignalTime: 0 },
        },
        closed: [
          {
            ...trade('ethereum', 10, 5),
            exitTime: 3,
            exit: 9.9,
            reason: 'stop',
            pnl: -0.06,
            fees: 0.01,
          },
        ],
      },
    },
  }

  it('keeps every dollar, the open trades and the signals already used', () => {
    const r = parseRaceState(legacy)
    if (!r.ok) throw new Error(r.error)
    expect(r.migrated).toBe(true)
    expect(raceStateSchema.safeParse(r.state).success).toBe(true)
    const a = r.state.strategies.a
    expect(a.open.map((t) => t.market)).toEqual(['bitcoin', 'USD-JPY'])
    expect(a.lastSignal).toEqual({ bitcoin: 7, 'USD-JPY': 8, ethereum: 0 })
    // USD/JPY: $50 of a USD-base pair is 50 units
    expect(a.open[1].units).toBeCloseTo(50)
    expect(a.closed[0].units).toBeCloseTo(0.5)
    // old money: slot cash + notional x move / entry
    const oldMoney = 499.9 + 500 + 1.5 + (100 * 1) / 100 + (50 * 2) / 158
    expect(summarize(r.state)[0].money).toBeCloseTo(oldMoney)
    expect(r.state.sizing).toEqual(RACE_SIZING)
    // a file in the new layout reads as it is
    const again = parseRaceState(r.state)
    expect(again.ok && again.migrated).toBe(false)
    expect(parseRaceState({ version: 1 }).ok).toBe(false)
  })
})

const cand = (
  market: string,
  entryTime: number,
  exitTime: number,
  over: Partial<Candidate> = {},
): Candidate => ({
  market,
  direction: 'long',
  entryTime,
  exitTime,
  entry: 100,
  exit: 110,
  stop: 95,
  takeProfit: 110,
  r: 0,
  reason: 'target',
  usdPerQuote: 1,
  feeRate: 0,
  leverage: 30,
  ...over,
})

describe('leaderboard: one account per strategy', () => {
  it('merges every market in time order and sizes each trade from the balance at entry', () => {
    const p = portfolioBacktest(1000, [
      cand('solana', 4, 6),
      cand('bitcoin', 1, 5),
      cand('ethereum', 2, 3, { exit: 95, reason: 'stop' }),
    ])
    // bitcoin and ethereum open on $1,000 ($20 risk each); ethereum stops first (-$20),
    // so solana risks 2% of $980 = $19.60 and makes 2R
    expect(p.trades.map((t) => [t.market, t.balanceAtEntry, +t.pnl.toFixed(2)])).toEqual([
      ['ethereum', 1000, -20],
      ['bitcoin', 1000, 40],
      ['solana', 980, 39.2],
    ])
    expect(p.end).toBeCloseTo(1059.2)
    expect(p.curve.map((x) => +x.toFixed(2))).toEqual([1000, 980, 1020, 1059.2])
  })

  it('the limits keep a 6th overlapping trade out, and fees come off', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((m, i) => cand(m, i, 100))
    const p = portfolioBacktest(1000, six)
    expect(p.trades).toHaveLength(5)
    expect(p.passed).toEqual([{ market: 'f', entryTime: 5, reason: '5 trades already open' }])
    const fee = portfolioBacktest(1000, [cand('a', 1, 2, { feeRate: 0.001 })])
    // $400 position: 40 cents in, 44 cents out
    expect(fee.trades[0].pnl).toBeCloseTo(40 - 0.84)
  })

  it('a daily trade only frees its money at the end of its exit day (no look-ahead)', () => {
    const D = 1_000 * 86_400
    // forex wins +$40 on day D (daily candle), crypto enters at D + 5h on hourly candles
    const p = portfolioBacktest(1000, [
      cand('GBP-USD', D - 86_400, D, { candleSec: 86_400 }),
      cand('bitcoin', D + 5 * 3_600, D + 9 * 3_600, { candleSec: 3_600 }),
    ])
    const btc = p.trades.find((t) => t.market === 'bitcoin')!
    expect(btc.balanceAtEntry).toBe(1000)
    // the next day it is in the balance
    const q = portfolioBacktest(1000, [
      cand('GBP-USD', D - 86_400, D, { candleSec: 86_400 }),
      cand('bitcoin', D + 86_400, D + 86_400 + 3_600, { candleSec: 3_600 }),
    ])
    expect(q.trades.find((t) => t.market === 'bitcoin')!.balanceAtEntry).toBeCloseTo(1040)
  })

  it('scores a strategy: per market, wins, best market, money a month, max drop', () => {
    const e = scoreStrategy({
      ruleId: 'x',
      start: 1000,
      markets: ['bitcoin', 'ethereum', 'solana'],
      candidates: [cand('bitcoin', 1, 2), cand('ethereum', 3, 4, { exit: 95, reason: 'stop' })],
      skipped: ['ripple'],
      days: 90,
    })
    expect(e.markets.map((m) => [m.id, m.trades.length, +m.profit.toFixed(2)])).toEqual([
      ['bitcoin', 1, 40],
      ['ethereum', 1, -20.8],
      ['solana', 0, 0],
    ])
    expect(e.end).toBeCloseTo(1019.2)
    expect(e.trades).toBe(2)
    expect(e.passed).toBe(0)
    expect(e.winRate).toBe(0.5)
    expect(e.best).toBe('bitcoin')
    expect(e.skipped).toEqual(['ripple'])
    expect(e.perMonth).toBeCloseTo((19.2 / 90) * 30)
    expect(e.maxDrawdown).toBeCloseTo(20.8 / 1040)
  })

  it('ranks by end money, ties to fewer trades', () => {
    const mk = (ruleId: string, exits: number[]) =>
      scoreStrategy({
        ruleId,
        start: 1000,
        markets: ['bitcoin'],
        candidates: exits.map((exit, i) => cand('bitcoin', i * 2, i * 2 + 1, { exit })),
        skipped: [],
        days: 30,
      })
    const ranked = rankEntries([
      mk('lose', [95]),
      mk('none', []),
      mk('win', [115]),
      mk('busy', [105, 97.5]),
    ])
    expect(ranked[0].ruleId).toBe('win')
    expect(ranked.at(-1)?.ruleId).toBe('lose')
    const tie = rankEntries([mk('flat', [100]), mk('none', [])])
    expect(tie.map((r) => r.ruleId)).toEqual(['none', 'flat'])
    expect(mk('none', []).best).toBeNull()
    expect(mk('none', []).winRate).toBeNull()
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
      start: 1000,
      markets: ['bitcoin'],
      candidates: [cand('bitcoin', 1, 2)],
      skipped: [],
      days: WINDOW_DAYS['1h'],
    })
    expect(e.days).toBe(30)
    expect(e.perMonth).toBeCloseTo(e.profit)
  })
})

describe('closeAll (John closes every trade by hand)', () => {
  it('books each trade at its market price with both fees, reason manual', async () => {
    const { closeAll } = await import('./live')
    const st = createRaceState(
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      10_000,
      0,
    )
    const t = {
      signalTime: 1,
      entryTime: 2,
      entryBucket: 2,
      units: 10_000,
      usdPerQuote: 1,
      margin: 400,
      entryFee: 0.8,
    }
    st.strategies.a.open = [
      { ...t, market: 'GBP-USD', direction: 'long', entry: 1.3, stop: 1.29, takeProfit: 1.32 },
      {
        ...t,
        market: 'USD-JPY',
        direction: 'short',
        entry: 150,
        stop: 151,
        takeProfit: 148,
        usdPerQuote: 1 / 150,
      },
    ]
    st.strategies.b.open = [
      { ...t, market: 'EUR-USD', direction: 'short', entry: 1.1, stop: 1.11, takeProfit: 1.08 },
    ]
    const r = closeAll(st, { 'GBP-USD': 1.305, 'EUR-USD': 1.102 }, 500, () => 0.0001)
    // GBP/USD long +50 pips on 10k = +$50, minus 0.8 entry and 1.305 exit fee
    expect(r.closed.find((c) => c.market === 'GBP-USD')).toMatchObject({
      reason: 'manual',
      exitTime: 500,
      exit: 1.305,
      strategy: 'A',
    })
    expect(r.closed.find((c) => c.market === 'GBP-USD')!.pnl).toBeCloseTo(50 - 0.8 - 1.305)
    expect(r.closed.find((c) => c.market === 'EUR-USD')!.pnl).toBeCloseTo(-20 - 0.8 - 1.102)
    // no price: stays open, named in missing, balance untouched by it
    expect(r.missing).toEqual(['USD-JPY'])
    expect(r.state.strategies.a.open.map((x) => x.market)).toEqual(['USD-JPY'])
    expect(r.state.strategies.a.balance).toBeCloseTo(10_000 + 50 - 0.8 - 1.305)
    expect(r.state.strategies.b.closed).toHaveLength(1)
    expect(raceStateSchema.safeParse(r.state).success).toBe(true)
    // the input state is not changed
    expect(st.strategies.a.open).toHaveLength(2)
  })
})
