import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import type { Signal } from '../rules/engine'
import { INSTRUMENTS } from '../paper/instruments'
import { feedOf } from '../feeds'
import { NOT_LIVE } from './account'
import {
  checkFunded,
  createFunded,
  dayWorstCase,
  lossAtStop,
  FUNDED,
  FUNDED_SIGNALS_FROM,
  fundedView,
  stepFunded,
  type FundedCandidate,
} from './funded'
import {
  applyDailyClose,
  createRaceState,
  raceStateSchema,
  stepStrategy,
  tradeRisk,
  type ClosedFundedTrade,
  type FundedState,
  type FundedTrade,
  type MarketTick,
} from './live'

/** Unix seconds of a Puerto Rico (AST = UTC-4) wall clock time. */
const ast = (y: number, mo: number, d: number, h: number, mi = 0) =>
  Date.UTC(y, mo - 1, d, h + 4, mi) / 1000
// Wednesday 2026-11-11, 09:00 AST: inside the entry window. FTMO day began 19:00 AST on the 10th.
const NOW = ast(2026, 11, 11, 9)
const PRICE: Record<string, number> = {
  'GBP-USD': 1.3,
  'EUR-USD': 1.15,
  'USD-CAD': 1.4,
  'USD-JPY': 155,
  'NZD-USD': 0.57,
  'GBP-JPY': 201.5,
  'pax-gold': 4000,
  bitcoin: 100_000,
  ethereum: 3500,
}
const flat = (time: number, p: number): OHLCCandle => ({
  time,
  open: p,
  high: p,
  low: p,
  close: p,
})
const mt = (market: string, over: Partial<MarketTick> = {}): MarketTick => ({
  market,
  signal: null,
  path: [flat(NOW - 900, PRICE[market])],
  price: PRICE[market],
  usdPerQuote: 1,
  feeRate: 0,
  leverage: market === 'bitcoin' || market === 'ethereum' ? 1 : 30,
  ...over,
})
/** A long signal 1% below / 2% above the price, or a short mirrored. */
const cand = (
  strategy: string,
  market: string,
  over: Partial<Signal> = {},
  extra: Partial<FundedCandidate> = {},
): FundedCandidate => {
  const p = PRICE[market]
  const short = over.direction === 'short'
  return {
    strategy,
    market,
    signal: {
      index: 0,
      time: NOW - 600,
      direction: 'long',
      entry: p,
      stop: short ? p * 1.01 : p * 0.99,
      takeProfit: short ? p * 0.98 : p * 1.02,
      ...over,
    },
    ...extra,
  }
}
const trade = (market: string, over: Partial<FundedTrade> = {}): FundedTrade => {
  const p = PRICE[market]
  return {
    strategy: 'a',
    market,
    direction: 'long',
    signalTime: NOW - 4000,
    entryTime: NOW - 3600,
    entryBucket: NOW - 3600,
    entry: p,
    stop: p * 0.99,
    takeProfit: p * 1.02,
    units: 200 / (p * 0.01),
    usdPerQuote: 1,
    margin: 20_000 / 30,
    entryFee: 0,
    ...over,
  }
}
const closedT = (
  pnl: number,
  exitTime: number,
  entryTime = exitTime - 3600,
): ClosedFundedTrade => ({
  ...trade('GBP-USD', { entryTime, entryBucket: entryTime }),
  exitTime,
  exit: 1.3,
  reason: pnl < 0 ? 'stop' : 'target',
  pnl,
  fees: 0,
})
/** An account with these closed trades, balance to match. */
const withClosed = (closed: ClosedFundedTrade[], open: FundedTrade[] = []): FundedState => ({
  ...createFunded(0),
  balance: FUNDED.startMoney + closed.reduce((a, t) => a + t.pnl, 0),
  closed,
  open,
})
const markets = Object.keys(PRICE).map((m) => mt(m))
/** The only strategy the funded test takes signals from: John's London v1. */
const V = FUNDED_SIGNALS_FROM

describe('funded test: size and caps', () => {
  it('risks 2% ($200) per trade, at most 2 open', () => {
    const r = stepFunded(
      createFunded(0),
      markets,
      [cand(V, 'GBP-USD'), cand(V, 'EUR-USD'), cand(V, 'bitcoin')],
      NOW,
    )
    expect(r.opened.map((t) => [t.strategy, t.market])).toEqual([
      [V, 'GBP-USD'],
      [V, 'EUR-USD'],
    ])
    for (const t of r.opened) expect(tradeRisk(t)).toBeCloseTo(200)
    expect(r.passed).toEqual([{ strategy: V, market: 'bitcoin', reason: '2 trades already open' }])
    expect(FUNDED.sizing).toEqual({ riskPct: 2, maxOpen: 2, maxOpenRiskPct: 4 })
  })

  it('sizes from the current balance, like the Lab accounts', () => {
    const f = withClosed([closedT(500, NOW - 90_000)])
    const [t] = stepFunded(f, markets, [cand(V, 'GBP-USD')], NOW).opened
    expect(tradeRisk(t)).toBeCloseTo(210) // 2% of $10,500
  })

  it('at most 3 new trades a day (FTMO day)', () => {
    // two opened and closed today, one open: the 4th signal waits for tomorrow
    const f = withClosed(
      [closedT(50, NOW - 1800, NOW - 7200), closedT(-20, NOW - 1700, NOW - 7100)],
      [trade('EUR-USD')],
    )
    expect(fundedView(f, PRICE, NOW).newToday).toBe(3)
    const r = stepFunded(f, markets, [cand(V, 'GBP-USD')], NOW)
    expect(r.opened).toHaveLength(0)
    expect(r.passed[0].reason).toBe('3 new trades today already')
    // the same three were yesterday: free again
    const tomorrow = ast(2026, 11, 12, 9)
    const f2 = { ...f, open: [] }
    expect(fundedView(f2, PRICE, tomorrow).newToday).toBe(0)
    const later = stepFunded(f2, markets, [cand(V, 'GBP-USD', { time: tomorrow - 600 })], tomorrow)
    expect(later.opened).toHaveLength(1)
  })

  it('the pound/dollar, dollar and crypto rules still apply', () => {
    const f = withClosed([], [trade('GBP-USD')])
    const r = stepFunded(
      f,
      markets,
      [cand(V, 'pax-gold', { direction: 'short' }), cand(V, 'ethereum')],
      NOW,
    )
    expect(r.opened).toHaveLength(0)
    expect(r.passed.map((x) => x.reason)).toEqual([
      'against the open GBP-USD long (one pound/dollar bet per account)',
      'no new crypto trades except Bitcoin',
    ])
  })

  it('no new trades outside 02:00 to 12:30 AST', () => {
    const r = stepFunded(
      createFunded(0),
      markets,
      [cand(V, 'GBP-USD')],
      NOW,
      'new trades only from 02:00 to 12:30 AST',
    )
    expect(r.opened).toHaveLength(0)
    expect(r.passed[0].reason).toBe('new trades only from 02:00 to 12:30 AST')
  })
})

describe('funded test: signal order and markets', () => {
  it("takes only John's London v1 signals; one signal makes one trade", () => {
    expect(V).toBe('johns-london-v1')
    const v1 = cand(V, 'GBP-USD')
    const other = cand('ema50-pullback', 'EUR-USD')
    const r = stepFunded(createFunded(0), markets, [other, v1], NOW)
    expect(r.opened.map((t) => [t.strategy, t.market])).toEqual([[V, 'GBP-USD']])
    // the other strategy's signal is ignored: no trade, no PASS line, not marked as used
    expect(r.passed).toEqual([])
    expect(r.funded.lastSignal).toEqual({ [`${V}:GBP-USD`]: v1.signal.time })
    // the next check sees the same signal: nothing new
    const again = stepFunded({ ...r.funded, open: [] }, markets, [v1], NOW + 900)
    expect(again.opened).toHaveLength(0)
    expect(again.passed).toHaveLength(0)
  })

  it('a signal from another strategy is ignored by the funded test but still trades in its Lab account', () => {
    const other = cand('ema50-pullback', 'EUR-USD')
    const f = stepFunded(createFunded(0), markets, [other], NOW)
    expect(f.opened).toHaveLength(0)
    expect(f.funded.open).toHaveLength(0)
    const lab = createRaceState([{ id: 'ema50-pullback', name: 'EMA 50 pullback' }], 10_000, 0)
    const r = stepStrategy(
      lab.strategies['ema50-pullback'],
      [mt('EUR-USD', { signal: other.signal })],
      NOW,
    )
    expect(r.opened.map((t) => t.market)).toEqual(['EUR-USD'])
  })

  it("a v1 trade keeps v1's own exits from its market tick: half at TP1, the forced close, the lone-wick rule", () => {
    const p = PRICE['GBP-USD']
    const deadline = NOW + 3600
    const tick = mt('GBP-USD', { target1: p * 1.01, deadline, confirm: true })
    const [t] = stepFunded(createFunded(0), [tick], [cand(V, 'GBP-USD')], NOW).opened
    expect(t).toMatchObject({ target1: p * 1.01, part1: 0.5, deadline, confirm: true })
    const f = { ...createFunded(0), open: [t], lastSignal: {} }
    const c = (time: number, o: number, h: number, l: number, cl: number): OHLCCandle => ({
      time,
      open: o,
      high: h,
      low: l,
      close: cl,
    })
    // A lone wick to the stop (closes back above, the next candle does not reach it): ignored.
    const wick = [c(NOW, p, p, p * 0.985, p), c(NOW + 900, p, p * 1.001, p * 0.999, p)]
    const kept = stepFunded(f, [{ ...tick, path: wick }], [], NOW + 1900)
    expect(kept.closed).toHaveLength(0)
    expect(kept.funded.open).toHaveLength(1)
    // TP1 reached and closed past: half closes there; the rest stays open.
    const tp1 = [
      c(NOW, p, p * 1.012, p, p * 1.011),
      c(NOW + 900, p * 1.011, p * 1.011, p * 1.01, p * 1.01),
    ]
    const half = stepFunded(f, [{ ...tick, path: tp1 }], [], NOW + 1900)
    expect(half.closed).toHaveLength(1)
    expect(half.closed[0]).toMatchObject({ reason: 'target', part1Of: 0.5, strategy: V })
    expect(half.funded.open[0].units).toBeCloseTo(t.units / 2)
    // two rows, one entry: it counts once in the 3 new trades a day
    expect(fundedView(half.funded, PRICE, NOW + 1900).newToday).toBe(1)
    // past the forced close with no later candle: the rest closes at the price
    const late = stepFunded(half.funded, [{ ...tick, path: tp1 }], [], deadline + 60)
    expect(late.closed[0]).toMatchObject({ reason: 'time' })
    expect(late.funded.open).toHaveLength(0)
  })

  it("v1's news close closes v1's funded trades, not a trade from before the switch", () => {
    const old = trade('GBP-USD', { strategy: 'london-breakout' })
    const own = trade('pax-gold', { strategy: V })
    const f = withClosed([], [old, own])
    const r = stepFunded(
      f,
      [mt('GBP-USD', { closeNow: true }), mt('pax-gold', { closeNow: true })],
      [],
      NOW,
    )
    expect(r.closed.map((x) => [x.market, x.reason])).toEqual([['pax-gold', 'news']])
    expect(r.funded.open.map((x) => x.strategy)).toEqual(['london-breakout'])
  })

  it('skips markets priced only from a once-a-day rate (every account, John 2026-11-11)', () => {
    const r = stepFunded(
      createFunded(0),
      markets,
      [cand(V, 'USD-JPY'), cand(V, 'NZD-USD'), cand(V, 'GBP-JPY')],
      NOW,
    )
    expect(r.opened).toHaveLength(0)
    expect(r.passed.map((x) => [x.market, x.reason])).toEqual([
      ['USD-JPY', 'no new trades on USD-JPY: priced from a once-a-day rate, not live'],
      ['NZD-USD', 'no new trades on NZD-USD: priced from a once-a-day rate, not live'],
      ['GBP-JPY', 'no new trades on GBP-JPY: priced from a once-a-day rate, not live'],
    ])
    // the list is exactly the forex the race does not price from Kraken
    const notLive = INSTRUMENTS.filter((i) => i.market === 'forex' && feedOf(i.id) !== 'kraken')
    expect(notLive.map((i) => i.id).sort()).toEqual([...NOT_LIVE].sort())
  })

  it('a new account only trades signals that come after it starts', () => {
    const seen = [cand(V, 'GBP-USD')]
    const f = createFunded(NOW * 1000, seen)
    expect(f.balance).toBe(10_000)
    expect(stepFunded(f, markets, seen, NOW).opened).toHaveLength(0)
    const fresh = cand(V, 'GBP-USD', { time: NOW - 60 })
    expect(stepFunded(f, markets, [fresh], NOW).opened).toHaveLength(1)
  })

  it('built-in rule signals keep their planned R at the fill', () => {
    const c = cand(
      V,
      'GBP-USD',
      { entry: 1.298, stop: 1.288, takeProfit: 1.318 },
      { reanchor: true },
    )
    const [t] = stepFunded(createFunded(0), markets, [c], NOW).opened
    expect(t.entry).toBe(1.3)
    expect(t.stop).toBeCloseTo(1.29)
    expect(t.takeProfit).toBeCloseTo(1.32)
  })
})

describe('funded test: FTMO limits', () => {
  it('stops new trades once the day is down 4% of the start ($400)', () => {
    const at4 = withClosed([closedT(-400, NOW - 1800)])
    const v = fundedView(at4, PRICE, NOW)
    expect(v.dayStart).toBe(10_000)
    expect(v.dayLoss).toBeCloseTo(400)
    expect(v.dayStopped).toBe(true)
    const r = stepFunded(at4, markets, [cand(V, 'GBP-USD')], NOW)
    expect(r.opened).toHaveLength(0)
    expect(r.passed[0].reason).toBe(
      'the day is down $400.00, 4% of the start or more: no new trades until the next FTMO day',
    )
    expect(r.funded.status).toBe('active')
    // $399 down is under the $400 stop, but a 2% trade on top ($192) is over the $475 worst case
    const under = withClosed([closedT(-399, NOW - 1800)])
    expect(fundedView(under, PRICE, NOW).dayStopped).toBe(false)
    expect(stepFunded(under, markets, [cand(V, 'GBP-USD')], NOW).passed[0].reason).toMatch(
      /^worst case today would be -\$591\.02 .* over the \$475\.00 cap/,
    )
    // $270 down: $270 + $194.60 (2% of $9,730) = $464.60 still fits
    const room = withClosed([closedT(-270, NOW - 1800)])
    expect(stepFunded(room, markets, [cand(V, 'GBP-USD')], NOW).opened).toHaveLength(1)
    // the next FTMO day (19:00 AST) starts from the lower balance: free again
    expect(fundedView(at4, PRICE, ast(2026, 11, 11, 19)).dayStopped).toBe(false)
  })

  it('fails when the day loses 5% of the start ($500) from its day-start balance, closed and open together', () => {
    // -$400 closed today, then the open GBP/USD trade hits its $200 stop: -$600
    const f = withClosed([closedT(-400, NOW - 1800)], [trade('GBP-USD')])
    const hit = mt('GBP-USD', {
      path: [
        flat(NOW - 900, 1.3),
        { time: NOW - 600, open: 1.29, high: 1.29, low: 1.285, close: 1.286 },
      ],
    })
    const r = stepFunded(f, [hit], [cand(V, 'EUR-USD')], NOW)
    expect(r.closed[0].reason).toBe('stop')
    expect(r.funded.status).toBe('failed')
    expect(r.funded.statusNote).toBe(
      'daily loss limit: the day lost $600.00 from its $10,000.00 start, the limit is $500.00 (5% of $10,000.00)',
    )
    expect(r.passed[0].reason).toBe('the funded test is failed')
    // open loss counts: -$400 closed plus -$100 open is exactly 5%
    const open = withClosed([closedT(-400, NOW - 1800)], [trade('GBP-USD')])
    const p = { ...PRICE, 'GBP-USD': 1.3 - 0.0065 } // half way to the stop
    expect(checkFunded(open, p, NOW).status).toBe('failed')
    expect(checkFunded(open, { ...p, 'GBP-USD': 1.2936 }, NOW).status).toBe('active')
    // once failed it stays failed, even after a recovery
    expect(checkFunded(r.funded, PRICE, NOW + 3600).status).toBe('failed')
  })

  describe('worst case under $475 (the $500 day limit minus 5% for slippage)', () => {
    // real fees: forex 0.007% a side, gold 0.02%
    const fx = Object.keys(PRICE).map((m) =>
      mt(m, { feeRate: m === 'pax-gold' ? 0.0002 : m === 'bitcoin' ? 0.001 : 0.00007 }),
    )

    it('two fresh 2% trades still fit, fees included', () => {
      const r = stepFunded(createFunded(0), fx, [cand(V, 'GBP-USD'), cand(V, 'pax-gold')], NOW)
      expect(r.opened.map((t) => t.market)).toEqual(['GBP-USD', 'pax-gold'])
      const worst = dayWorstCase(r.funded, NOW)
      expect(worst).toBeGreaterThan(400) // $200 + $200 + four fees
      expect(worst).toBeLessThan(475)
      expect(lossAtStop(r.opened[1])).toBeCloseTo(200 + 20_000 * 0.0002 + 19_800 * 0.0002)
    })

    it("the reviewer's repro: after a $209 stop, two trades at once would risk $612: the second waits", () => {
      const f = withClosed([closedT(-209, NOW - 1800)])
      const r = stepFunded(f, fx, [cand(V, 'GBP-USD'), cand(V, 'EUR-USD')], NOW)
      expect(r.opened.map((t) => t.market)).toEqual(['GBP-USD'])
      expect(r.passed).toHaveLength(1)
      expect(r.passed[0].reason).toMatch(
        /^worst case today would be -\$6\d\d\.\d\d .* \$475\.00 cap/,
      )
      // what is left can't break the $500 limit even if both stops hit
      expect(dayWorstCase(r.funded, NOW)).toBeLessThan(475)
    })

    it('a gain earlier in the day does not lift the cap; an open winner still counts at its stop', () => {
      const f = withClosed([closedT(300, NOW - 1800)], [trade('GBP-USD')])
      expect(dayWorstCase(f, NOW)).toBeCloseTo(200) // realized gain counts as 0, not -$300
    })
  })

  it('the day limits stay $500 and $400 when the account is up or down (FTMO: % of the start)', () => {
    // yesterday +$800: today starts at $10,800, but the limits are still $500 and $400
    const up = withClosed([closedT(800, NOW - 90_000), closedT(-400, NOW - 1800)])
    const v = fundedView(up, PRICE, NOW)
    expect(v.dayStart).toBe(10_800)
    expect(v.dayLimit).toBe(500)
    expect(v.dayStopped).toBe(true) // $400 down, under 4% of $10,800 but 4% of the start
    expect(checkFunded(up, PRICE, NOW).status).toBe('active')
    const out = withClosed([closedT(800, NOW - 90_000), closedT(-500, NOW - 1800)])
    expect(checkFunded(out, PRICE, NOW).status).toBe('failed') // $500, under 5% of $10,800
    // yesterday -$500: today starts at $9,500, and $399 down still trades
    const down = withClosed([closedT(-500, NOW - 90_000), closedT(-399, NOW - 1800)])
    expect(fundedView(down, PRICE, NOW).dayStopped).toBe(false)
    expect(checkFunded(down, PRICE, NOW).status).toBe('active')
  })

  it('fails when the balance or the money falls under $9,000 (10% static)', () => {
    const days = [ast(2026, 11, 6, 9), ast(2026, 11, 9, 9), ast(2026, 11, 10, 9)]
    const lost = (last: number) =>
      withClosed([closedT(-400, days[0]), closedT(-400, days[1]), closedT(last, days[2])])
    // $9,000 exactly is still alive; each day stayed under 5%
    expect(checkFunded(lost(-200), PRICE, NOW).status).toBe('active')
    const out = checkFunded(lost(-201), PRICE, NOW)
    expect(out.status).toBe('failed')
    expect(out.statusNote).toBe('max loss: money fell under $9,000.00 (10% below the start)')
    // money (open P&L) counts too: $9,100 balance with a trade $150 down
    const f = withClosed(
      [closedT(-400, days[0]), closedT(-400, days[1]), closedT(-100, days[2])],
      [trade('GBP-USD')],
    )
    const down = { ...PRICE, 'GBP-USD': 1.3 - 0.00975 } // $150 down of a $200 risk
    const v = fundedView(f, down, NOW)
    expect(v.money).toBeCloseTo(8950)
    expect(v.dayLoss).toBeCloseTo(150) // under the day limit of $500
    expect(checkFunded(f, down, NOW).statusNote).toContain('max loss')
  })

  it('the FTMO day starts at midnight in Prague: 19:00 AST in winter, 18:00 AST in summer', () => {
    // a $450 loss booked at 18:30 AST counts for the evening in summer...
    const summer = ast(2026, 7, 15, 18, 30)
    const s = withClosed([closedT(-450, summer)])
    expect(fundedView(s, PRICE, ast(2026, 7, 15, 20)).dayLoss).toBeCloseTo(450)
    expect(fundedView(s, PRICE, ast(2026, 7, 15, 20)).dayStopped).toBe(true)
    // ...but was the day before in winter (Prague midnight at 19:00 AST)
    const winter = ast(2026, 11, 11, 18, 30)
    const w = withClosed([closedT(-450, winter)])
    expect(fundedView(w, PRICE, ast(2026, 11, 11, 18, 45)).dayLoss).toBeCloseTo(450)
    expect(fundedView(w, PRICE, ast(2026, 11, 11, 20)).dayLoss).toBe(0)
    expect(fundedView(w, PRICE, ast(2026, 11, 11, 20)).dayStart).toBeCloseTo(9550)
  })

  it('passes with +$1,000 and at least 4 trading days', () => {
    const d = (day: number) => ast(2026, 11, day, 9)
    const three = withClosed([closedT(400, d(9)), closedT(400, d(10)), closedT(250, d(11))])
    const v = fundedView(three, PRICE, NOW)
    expect(v.days).toBe(3)
    expect(checkFunded(three, PRICE, NOW).status).toBe('active') // target reached, only 3 days
    const four = withClosed([...three.closed, closedT(-10, d(12))])
    const passed = checkFunded(four, PRICE, ast(2026, 11, 12, 12))
    expect(passed.status).toBe('passed')
    expect(passed.statusNote).toBe('+$1,000.00 target reached in 4 trading days')
    // under the target after 4 days: still going
    const short = withClosed([...three.closed.slice(0, 2), closedT(150, d(11)), closedT(10, d(12))])
    expect(checkFunded(short, PRICE, ast(2026, 11, 12, 12)).status).toBe('active')
    // passed: no new trades
    const r = stepFunded(passed, markets, [cand(V, 'GBP-USD', { time: d(12) })], d(12) + 60)
    expect(r.passed[0].reason).toBe('the funded test is passed')
  })
})

describe('funded test in the race file', () => {
  it('is saved with the race and closed at 12:45 like every account', () => {
    const st = createRaceState([{ id: 'a', name: 'A' }], 10_000, 0)
    st.funded = withClosed([], [trade('GBP-USD')])
    st.prices = { 'GBP-USD': 1.305 }
    st.dailyCloseAt = ast(2026, 11, 11, 2)
    expect(raceStateSchema.parse(JSON.parse(JSON.stringify(st))).funded?.open).toHaveLength(1)
    const r = applyDailyClose(st, ast(2026, 11, 11, 12, 45), () => 0)
    expect(r.closed.map((c) => [c.strategy, c.reason])).toEqual([['Funded test', 'session']])
    expect(r.state.funded?.open).toHaveLength(0)
    expect(r.state.funded?.balance).toBeCloseTo(10_000 + (200 / 0.013) * 0.005)
    expect(r.state.funded?.closed[0].strategy).toBe('a')
  })

  it('a race file from before the funded test still reads', () => {
    const st = createRaceState([{ id: 'a', name: 'A' }], 10_000, 0)
    expect(raceStateSchema.safeParse(st).success).toBe(true)
  })
})
