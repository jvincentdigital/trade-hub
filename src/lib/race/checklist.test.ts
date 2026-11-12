import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import type { NewsEvent } from '../lab/news'
import { newsCurrencies, roundStep, tradeChecks, withChecks, type TradeChecks } from './checklist'
import {
  closedLiveTradeSchema,
  createRaceState,
  liveTradeSchema,
  stepStrategy,
  type MarketTick,
} from './live'

const H = 3600
const D = 86_400
/** Thursday 2026-11-12 10:00 UTC: the entry. */
const T = Date.UTC(2026, 10, 12, 10) / 1000

/** Closed 1h candles ending at `end`, flat at `price`, each `range` high to low (so ATR = range). */
const hours = (n: number, range: number, price = 1.3, end = T): OHLCCandle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: end - (n - i) * H,
    open: price,
    high: price + range / 2,
    low: price - range / 2,
    close: price,
  }))

const base = { market: 'GBP-USD', entry: 1.3, stop: 1.29, entryTime: T, news: [], h1: [] }
const ev = (minutesFromEntry: number, currency = 'USD', event = 'CPI m/m'): NewsEvent => ({
  time: T + minutesFromEntry * 60,
  currency,
  event,
})

describe('check 1: red news within 30 minutes of the entry', () => {
  it('a red event 20 minutes after the entry is a no, with its name', () => {
    const c = tradeChecks({ ...base, news: [ev(20)] }).news
    expect(c).toEqual({ ok: false, text: 'Red news within 30 min: CPI m/m (USD)' })
  })

  it('a red event 20 minutes before the entry is a no too', () => {
    expect(tradeChecks({ ...base, news: [ev(-20, 'GBP')] }).news.ok).toBe(false)
  })

  it('events 45 minutes away, or for another currency, are a yes', () => {
    const c = tradeChecks({ ...base, news: [ev(45), ev(-45), ev(5, 'JPY')] }).news
    expect(c).toEqual({ ok: true, text: 'No red news within 30 min' })
  })

  it('no news list at entry: not known', () => {
    expect(tradeChecks({ ...base, news: null }).news.ok).toBeNull()
  })

  it('counts the pair for forex and USD for gold, crypto and US30', () => {
    expect(newsCurrencies('GBP-USD')).toEqual(['GBP', 'USD'])
    expect(newsCurrencies('pax-gold')).toEqual(['USD'])
    expect(newsCurrencies('bitcoin')).toEqual(['USD'])
    expect(newsCurrencies('US30')).toEqual(['USD'])
  })
})

describe('check 2: a calmer market at entry (1h ATR 14)', () => {
  const r = 0.002

  it('no move: calmer when the ATR now is under its 20-day average', () => {
    const h1 = [...hours(700, 2 * r, 1.3, T - 20 * H), ...hours(20, r)]
    expect(tradeChecks({ ...base, h1 }).calm).toEqual({
      ok: true,
      text: 'Calmer than its 20-day average',
    })
  })

  it('no move: not calmer when the last hours are wilder than the average', () => {
    const h1 = [...hours(700, r, 1.3, T - 20 * H), ...hours(20, 2 * r)]
    expect(tradeChecks({ ...base, h1 }).calm.ok).toBe(false)
  })

  it('no move: under 20 days of candles is not known', () => {
    expect(tradeChecks({ ...base, h1: hours(240, r) }).calm.ok).toBeNull()
    expect(tradeChecks({ ...base, h1: [] }).calm.ok).toBeNull()
  })

  it('with a move: compares with the ATR when the move started', () => {
    const moveStart = T - 20 * H
    const wildThenCalm = [...hours(100, 2 * r, 1.3, moveStart), ...hours(20, r)]
    expect(tradeChecks({ ...base, moveStart, h1: wildThenCalm }).calm).toEqual({
      ok: true,
      text: 'Calmer than at the start of the move',
    })
    const calmThenWild = [...hours(100, r, 1.3, moveStart), ...hours(20, 2 * r)]
    expect(tradeChecks({ ...base, moveStart, h1: calmThenWild }).calm.ok).toBe(false)
  })

  it('with a move: no candle before the move is not known', () => {
    expect(tradeChecks({ ...base, moveStart: T - 500 * H, h1: hours(100, r) }).calm.ok).toBeNull()
  })
})

describe('check 3: a round number near the entry or the stop', () => {
  // 1h candles of a 0.008 range at a flat price: daily ATR 0.008, so "near" is 0.0008.
  const gbp = (entry: number, stop: number) =>
    tradeChecks({ ...base, entry, stop, h1: hours(20 * 24, 0.008, entry) }).round

  it('levels: 50 pips on forex (0.50 on yen pairs), $10 on gold, none on crypto', () => {
    expect(roundStep('GBP-USD')).toBeCloseTo(0.005)
    expect(roundStep('USD-JPY')).toBeCloseTo(0.5)
    expect(roundStep('pax-gold')).toBe(10)
    expect(roundStep('bitcoin')).toBeNull()
  })

  it('near the entry: 1.34505 is 0.5 pip from 1.3450', () => {
    expect(gbp(1.34505, 1.3385)).toEqual({ ok: true, text: 'Round number 1.3450 near the entry' })
  })

  it('near the stop: the stop 1.3404 is 4 pips from 1.3400', () => {
    expect(gbp(1.3425, 1.3404)).toEqual({ ok: true, text: 'Round number 1.3400 near the stop' })
  })

  it('far: 25 pips from every 50-pip level is a no', () => {
    expect(gbp(1.3425, 1.3375)).toEqual({
      ok: false,
      text: 'No round number near the entry or stop',
    })
  })

  it('gold uses $10 levels: $2 from one is near, $5 is not (daily ATR $40)', () => {
    const gold = (entry: number, stop: number) =>
      tradeChecks({ ...base, market: 'pax-gold', entry, stop, h1: hours(20 * 24, 40, entry) }).round
    expect(gold(4128, 4105)).toEqual({ ok: true, text: 'Round number $4,130 near the entry' })
    expect(gold(4125, 4105).ok).toBe(false)
  })

  it('crypto, or too few candles for a daily ATR: not known', () => {
    expect(tradeChecks({ ...base, market: 'bitcoin' }).round.ok).toBeNull()
    expect(tradeChecks({ ...base, h1: hours(48, 0.008) }).round.ok).toBeNull()
  })
})

describe('adding the checklist never changes a trade', () => {
  const checks: TradeChecks = {
    news: { ok: true, text: 'a' },
    calm: { ok: false, text: 'b' },
    round: { ok: null, text: 'c' },
  }
  const old = { market: 'EUR-USD', entryTime: T - D }
  const fresh = { market: 'GBP-USD', entryTime: T }

  it('only trades opened this check get one; the others stay the same objects', () => {
    const open = [old, fresh]
    const out = withChecks(open, [fresh], () => checks)
    expect(out[0]).toBe(old)
    expect(out[1]).toEqual({ ...fresh, checks })
    expect(withChecks(open, [], () => checks)).toBe(open)
  })

  it('a check that throws leaves the trade as it was', () => {
    const out = withChecks([fresh], [fresh], () => {
      throw new Error('boom')
    })
    expect(out[0]).toBe(fresh)
  })

  it('a trade opens exactly as before; the checklist only adds its own field', () => {
    const s = createRaceState([{ id: 'r', name: 'R' }], 1000).strategies.r
    const path = hours(30, 0.002)
    const tick: MarketTick = {
      market: 'GBP-USD',
      signal: {
        index: 0,
        time: T - H,
        direction: 'long',
        entry: 1.3,
        stop: 1.29,
        takeProfit: 1.32,
      },
      path,
      price: 1.3,
      usdPerQuote: 1,
      feeRate: 0.00007,
      leverage: 30,
    }
    const r = stepStrategy(s, [tick], T)
    expect(r.opened).toHaveLength(1)
    const open = withChecks(r.strategy.open, r.opened, (t) =>
      tradeChecks({ ...t, news: [], h1: path }),
    )
    const unchecked = open.map((t) => {
      const copy = { ...t }
      delete copy.checks
      return copy
    })
    expect(unchecked).toEqual(r.strategy.open)
    expect(open[0].checks?.news.ok).toBe(true)
  })

  it('race.json keeps the checklist, and older trades without one still read', () => {
    const t = {
      market: 'GBP-USD',
      direction: 'long',
      signalTime: T - H,
      entryTime: T,
      entryBucket: T - H,
      entry: 1.3,
      stop: 1.29,
      takeProfit: 1.32,
      units: 1000,
      usdPerQuote: 1,
      margin: 43,
      entryFee: 0.1,
    }
    expect(liveTradeSchema.parse({ ...t, checks }).checks).toEqual(checks)
    expect(liveTradeSchema.parse(t).checks).toBeUndefined()
    const closed = {
      ...t,
      checks,
      exitTime: T + H,
      exit: 1.32,
      reason: 'target',
      pnl: 20,
      fees: 0.2,
    }
    expect(closedLiveTradeSchema.parse(closed).checks).toEqual(checks)
  })
})
