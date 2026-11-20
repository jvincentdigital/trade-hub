import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import type { Signal } from '../rules/engine'
import { BUILT_IN_RULES } from '../rules/presets'
import { INSTRUMENTS } from '../paper/instruments'
import {
  COMBINED,
  COMBINED_SIGNALS_FROM,
  combinedView,
  contradiction,
  createCombined,
  currenciesOf,
  legsOf,
  refusalLine,
  SAME_BET,
  stepCombined,
} from './combined'
import type { FundedCandidate, FundedTick } from './funded'
import { JOHNS_LONDON } from './johnsLondonLive'
import { LAB_BOTS } from './labBots'
import { LONDON_BREAKOUT } from './londonBreakout'
import {
  raceStateSchema,
  createRaceState,
  type ClosedFundedTrade,
  type CombinedState,
  type FundedTrade,
} from './live'

/** Unix seconds of a Puerto Rico (AST = UTC-4) wall clock time. */
const ast = (y: number, mo: number, d: number, h: number, mi = 0) =>
  Date.UTC(y, mo - 1, d, h + 4, mi) / 1000
// Wednesday 2026-11-11, 09:00 AST: inside the entry window. FTMO day began 19:00 AST on the 10th.
const NOW = ast(2026, 11, 11, 9)
const PRICE: Record<string, number> = {
  'GBP-USD': 1.3,
  'EUR-USD': 1.15,
  'EUR-GBP': 0.88,
  'USD-CAD': 1.4,
  'USD-CHF': 0.8,
  'AUD-USD': 0.65,
  'USD-JPY': 155,
  'GBP-JPY': 201.5,
  'pax-gold': 4000,
  bitcoin: 100_000,
  ethereum: 3500,
  US30: 47_000,
}
const flat = (time: number, p: number): OHLCCandle => ({
  time,
  open: p,
  high: p,
  low: p,
  close: p,
})
const mt = (market: string, over: Partial<FundedTick> = {}): FundedTick => ({
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
  const short = over.direction === 'short'
  return {
    strategy: 'a',
    market,
    direction: 'long',
    signalTime: NOW - 4000,
    entryTime: NOW - 3600,
    entryBucket: NOW - 3600,
    entry: p,
    stop: short ? p * 1.01 : p * 0.99,
    takeProfit: short ? p * 0.98 : p * 1.02,
    units: 200 / (p * 0.01),
    usdPerQuote: 1,
    margin: 20_000 / 30 / 10,
    entryFee: 0,
    ...over,
  }
}
const withOpen = (open: FundedTrade[], over: Partial<CombinedState> = {}): CombinedState => ({
  ...createCombined(NOW * 1000),
  open,
  ...over,
})
const S = 'johns-london-v1'

describe('legs of every market the race trades', () => {
  it('splits forex, crosses, gold, crypto and US30 into two currencies', () => {
    expect(currenciesOf('EUR-USD')).toEqual(['EUR', 'USD'])
    expect(currenciesOf('USD-JPY')).toEqual(['USD', 'JPY'])
    expect(currenciesOf('EUR-GBP')).toEqual(['EUR', 'GBP'])
    expect(currenciesOf('GBP-JPY')).toEqual(['GBP', 'JPY'])
    expect(currenciesOf('pax-gold')).toEqual(['XAU', 'USD'])
    expect(currenciesOf('bitcoin')).toEqual(['BTC', 'USD'])
    expect(currenciesOf('US30')).toEqual(['US30', 'USD'])
    expect(currenciesOf('EUR-JPY')).toEqual(['EUR', 'JPY'])
    expect(currenciesOf('nope')).toBeNull()
  })

  it('knows every instrument', () => {
    for (const i of INSTRUMENTS) expect(currenciesOf(i.id), i.id).not.toBeNull()
  })

  it('a buy is long the first and short the second; a sell the other way', () => {
    expect(legsOf('EUR-USD', 'long')).toEqual([
      { currency: 'EUR', side: 1 },
      { currency: 'USD', side: -1 },
    ])
    expect(legsOf('GBP-JPY', 'short')).toEqual([
      { currency: 'GBP', side: -1 },
      { currency: 'JPY', side: 1 },
    ])
    expect(legsOf('pax-gold', 'short')).toEqual([
      { currency: 'XAU', side: -1 },
      { currency: 'USD', side: 1 },
    ])
  })
})

describe('the guard: no contradicting trades', () => {
  it('a: refuses any currency on the opposite side of an open trade', () => {
    const open = [trade('GBP-USD')]
    expect(contradiction({ market: 'GBP-JPY', direction: 'short' }, open)).toBe(
      'short GBP against the open GBP-USD buy',
    )
    expect(contradiction({ market: 'pax-gold', direction: 'short' }, open)).toBe(
      'long USD against the open GBP-USD buy',
    )
    expect(contradiction({ market: 'EUR-GBP', direction: 'long' }, open)).toBe(
      'short GBP against the open GBP-USD buy',
    )
    // The same way on both of its currencies: allowed.
    expect(contradiction({ market: 'GBP-JPY', direction: 'long' }, open)).toBeNull()
    expect(contradiction({ market: 'USD-CAD', direction: 'short' }, open)).toBeNull()
  })

  it('b: refuses a same bet the other way round', () => {
    expect(contradiction({ market: 'GBP-USD', direction: 'short' }, [trade('EUR-USD')])).toMatch(
      /^the same bet as the open EUR-USD buy, the other way round: EUR-USD and GBP-USD move together \(\+0\.70/,
    )
    // USD/JPY moves opposite EUR/USD: a USD/JPY buy against an open EUR/USD buy.
    expect(contradiction({ market: 'USD-JPY', direction: 'long' }, [trade('EUR-USD')])).toMatch(
      /^the same bet as the open EUR-USD buy, the other way round: USD-JPY and EUR-USD move opposite \(-0\.49/,
    )
    expect(
      contradiction({ market: 'GBP-JPY', direction: 'long' }, [
        trade('EUR-JPY', { direction: 'short' }),
      ]),
    ).toMatch(/EUR-JPY and GBP-JPY move together \(\+0\.76/)
    // The same way round is the same bet, not a contradiction.
    expect(contradiction({ market: 'USD-JPY', direction: 'short' }, [trade('EUR-USD')])).toBeNull()
    // A group with no shared currency still fires (the table is the rule, not the legs).
    const groups = [{ a: 'EUR-GBP', b: 'USD-JPY', corr: 0.5 }]
    expect(
      contradiction({ market: 'USD-JPY', direction: 'short' }, [trade('EUR-GBP')], groups),
    ).toMatch(/^the same bet as the open EUR-GBP buy/)
  })

  it('b: the table holds the three measured groups', () => {
    expect(SAME_BET).toEqual([
      { a: 'EUR-USD', b: 'GBP-USD', corr: 0.7 },
      { a: 'EUR-JPY', b: 'GBP-JPY', corr: 0.76 },
      { a: 'USD-JPY', b: 'EUR-USD', corr: -0.49 },
    ])
  })

  it('c: at most 2 open the same way on one currency, the dollar too', () => {
    // Two trades short USD already.
    const open = [trade('EUR-USD'), trade('pax-gold')]
    expect(contradiction({ market: 'AUD-USD', direction: 'long' }, open)).toBe(
      'short USD is already in 2 open trades (at most 2 the same way on one currency)',
    )
    expect(
      contradiction({ market: 'GBP-JPY', direction: 'long' }, [
        trade('GBP-USD'),
        trade('EUR-GBP', { direction: 'short' }),
      ]),
    ).toBe('long GBP is already in 2 open trades (at most 2 the same way on one currency)')
  })

  it('c: at most 4 open in all', () => {
    const open = [
      trade('EUR-USD'),
      trade('USD-JPY', { direction: 'short' }),
      trade('bitcoin'),
      trade('US30', { direction: 'short' }),
    ]
    expect(contradiction({ market: 'EUR-GBP', direction: 'long' }, open)).toBe(
      '4 trades already open (at most 4)',
    )
  })

  it('never two open trades in the same market', () => {
    expect(
      contradiction({ market: 'GBP-USD', direction: 'long' }, [trade('GBP-USD', { strategy: S })]),
    ).toBe(`a GBP-USD trade is already open (a buy from ${S})`)
  })
})

describe('stepCombined', () => {
  it('starts empty with $10,000 and marks the signals out there now as used', () => {
    const c = createCombined(NOW * 1000, [cand(S, 'GBP-USD')])
    expect(c.balance).toBe(10_000)
    expect(c.lastSignal).toEqual({ [`${S}:GBP-USD`]: NOW - 600 })
    const r = stepCombined(c, [mt('GBP-USD', { strategy: S })], [cand(S, 'GBP-USD')], NOW)
    expect(r.opened).toHaveLength(0)
    expect(r.refused).toHaveLength(0)
  })

  it('sizes 2% of the balance on the fill-to-stop distance, down to 0.01 lot', () => {
    const r = stepCombined(
      createCombined(NOW * 1000),
      [mt('GBP-USD', { strategy: S })],
      [cand(S, 'GBP-USD')],
      NOW,
    )
    expect(r.opened).toHaveLength(1)
    const t = r.opened[0]
    // $200 over a 0.013 stop = 15,384.6 units, down to 15,000.
    expect(t.units).toBe(15_000)
    expect(t.strategy).toBe(S)
    expect(t.stop).toBeCloseTo(1.287)
  })

  it('refuses with the reason and logs it in plain words', () => {
    const c = withOpen([trade('GBP-USD', { strategy: S })])
    const r = stepCombined(
      c,
      [mt('GBP-JPY', { strategy: 'london-breakout' })],
      [cand('london-breakout', 'GBP-JPY', { direction: 'short' })],
      NOW,
      null,
      {},
      ['london-breakout'],
    )
    expect(r.opened).toHaveLength(0)
    expect(r.refused).toHaveLength(1)
    expect(refusalLine(r.refused[0])).toBe(
      'REFUSED Combined: GBP-JPY sell from london-breakout: short GBP against the open GBP-USD buy',
    )
    expect(r.combined.refused).toEqual(r.refused)
    // The signal is used: offered again, it is not refused twice.
    const again = stepCombined(
      r.combined,
      [mt('GBP-JPY', { strategy: 'london-breakout' })],
      [cand('london-breakout', 'GBP-JPY', { direction: 'short' })],
      NOW + 900,
      null,
      {},
      ['london-breakout'],
    )
    expect(again.refused).toHaveLength(0)
  })

  it('takes signals of the same check in priority order', () => {
    // Both signal GBP/USD, the other way round. The list order wins, not the order handed in.
    const ticks = [mt('GBP-USD', { strategy: 'a' }), mt('GBP-USD', { strategy: 'b' })]
    const cands = [cand('b', 'GBP-USD', { direction: 'short' }), cand('a', 'GBP-USD')]
    const ab = stepCombined(createCombined(0), ticks, cands, NOW, null, {}, ['a', 'b'])
    expect(ab.opened.map((t) => [t.strategy, t.direction])).toEqual([['a', 'long']])
    expect(ab.refused[0]).toMatchObject({
      strategy: 'b',
      reason: expect.stringMatching(/already open/),
    })
    const ba = stepCombined(createCombined(0), ticks, cands, NOW, null, {}, ['b', 'a'])
    expect(ba.opened.map((t) => [t.strategy, t.direction])).toEqual([['b', 'short']])
  })

  it('ignores strategies not in its list', () => {
    const r = stepCombined(
      createCombined(0),
      [mt('GBP-USD', { strategy: 'x' })],
      [cand('x', 'GBP-USD')],
      NOW,
      null,
      {},
      ['a'],
    )
    expect(r.opened).toHaveLength(0)
    expect(r.combined.lastSignal).toEqual({})
  })

  it('opens nothing once the day is down 4% of its opening balance', () => {
    // A $450 loss closed today: 4.5% of the $10,000 the day opened with.
    const lost: ClosedFundedTrade = {
      ...trade('EUR-USD'),
      exitTime: NOW - 1800,
      exit: 1.14,
      reason: 'stop',
      pnl: -450,
      fees: 0,
    }
    const c = withOpen([], { balance: 9_550, closed: [lost] })
    expect(combinedView(c, PRICE, NOW).dayStopped).toBe(true)
    const r = stepCombined(
      c,
      [mt('GBP-USD', { strategy: S })],
      [cand(S, 'GBP-USD')],
      NOW,
      null,
      {},
      [S],
    )
    expect(r.opened).toHaveLength(0)
    expect(r.refused[0].reason).toMatch(
      /^the day is down \$450\.00, 4% of its \$10,000\.00 opening balance/,
    )
    // The same loss closed yesterday: today opened at $9,550 and is flat, so it trades.
    const old = withOpen([], { balance: 9_550, closed: [{ ...lost, exitTime: NOW - 86_400 }] })
    const ok = stepCombined(
      old,
      [mt('GBP-USD', { strategy: S })],
      [cand(S, 'GBP-USD')],
      NOW,
      null,
      {},
      [S],
    )
    expect(ok.opened).toHaveLength(1)
  })

  it('applies the entry window and the race market rules', () => {
    const out = stepCombined(
      createCombined(0),
      [mt('GBP-USD', { strategy: S })],
      [cand(S, 'GBP-USD')],
      NOW,
      'new trades only from 02:00 to 12:30 AST',
      {},
      [S],
    )
    expect(out.refused[0].reason).toBe('new trades only from 02:00 to 12:30 AST')
    const eth = stepCombined(
      createCombined(0),
      [mt('ethereum', { strategy: S })],
      [cand(S, 'ethereum')],
      NOW,
      null,
      {},
      [S],
    )
    expect(eth.refused[0].reason).toMatch(/no new crypto trades except Bitcoin/)
  })

  it('an allowed trade follows its own strategy exits: first target, lone wick, news close', () => {
    const v1 = mt('GBP-USD', { strategy: S, target1: 1.31, confirm: true })
    const other = mt('GBP-USD', { strategy: 'other' })
    const r = stepCombined(createCombined(0), [other, v1], [cand(S, 'GBP-USD')], NOW, null, {}, [S])
    expect(r.opened[0]).toMatchObject({ target1: 1.31, part1: 0.5, confirm: true })
    // Next check: a candle through the first target that closes past it, on v1's own tick.
    const later = NOW + 1800
    const path = [
      flat(NOW - 900, 1.3),
      { time: NOW + 900, open: 1.3, high: 1.312, low: 1.3, close: 1.311 },
    ]
    const r2 = stepCombined(
      r.combined,
      [
        mt('GBP-USD', { strategy: 'other', path, price: 1.311 }),
        mt('GBP-USD', { strategy: S, path, price: 1.311, closeNow: false }),
      ],
      [],
      later,
      null,
      {},
      [S],
    )
    expect(r2.closed).toHaveLength(1)
    expect(r2.closed[0]).toMatchObject({ reason: 'target', part1Of: 0.5, exit: 1.31 })
    expect(r2.combined.open[0].units).toBeCloseTo(r.opened[0].units / 2)
    // Its strategy's news close: the rest closes at the price now.
    const r3 = stepCombined(
      r2.combined,
      [
        mt('GBP-USD', {
          strategy: S,
          path: [...path, flat(later, 1.305)],
          price: 1.305,
          closeNow: true,
        }),
      ],
      [],
      later + 60,
      null,
      {},
      [S],
    )
    expect(r3.closed[0]).toMatchObject({ reason: 'news', exit: 1.305 })
    expect(r3.combined.open).toHaveLength(0)
    expect(r3.combined.balance).toBeCloseTo(10_000 + r2.closed[0].pnl + r3.closed[0].pnl)
  })

  it("another strategy's news close does not close its trade", () => {
    const t = trade('GBP-USD', { strategy: S })
    const r = stepCombined(
      withOpen([t]),
      [mt('GBP-USD', { strategy: 'other', closeNow: true, path: [flat(NOW - 60, 1.3)] })],
      [],
      NOW,
    )
    expect(r.closed).toHaveLength(0)
    expect(r.combined.open).toHaveLength(1)
  })

  it('keeps refusals of the last 7 days only', () => {
    const old = {
      at: NOW - 8 * 86_400,
      strategy: S,
      market: 'EUR-USD',
      direction: 'long' as const,
      reason: 'x',
    }
    const kept = { ...old, at: NOW - 6 * 86_400 }
    const r = stepCombined(withOpen([], { refused: [old, kept] }), [], [], NOW)
    expect(r.combined.refused).toEqual([kept])
  })
})

describe('the signal list', () => {
  it('names only strategies the race runs, each once, John London v1 first', () => {
    const known = new Set([
      JOHNS_LONDON.id,
      LONDON_BREAKOUT.id,
      ...LAB_BOTS.map((b) => b.id),
      ...BUILT_IN_RULES.map((r) => r.id),
    ])
    expect(new Set(COMBINED_SIGNALS_FROM).size).toBe(COMBINED_SIGNALS_FROM.length)
    for (const id of COMBINED_SIGNALS_FROM) expect(known.has(id), id).toBe(true)
    // For now every strategy whose signals the check hands over.
    expect(COMBINED_SIGNALS_FROM.length).toBe(known.size)
    expect(COMBINED_SIGNALS_FROM[0]).toBe(JOHNS_LONDON.id)
  })

  it('race.json keeps the account', () => {
    const state = { ...createRaceState([], 1000, 0), combined: createCombined(0) }
    expect(raceStateSchema.parse(state).combined).toEqual(createCombined(0))
    expect(COMBINED.startMoney).toBe(10_000)
  })
})
