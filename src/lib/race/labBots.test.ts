import { describe, expect, it } from 'vitest'
import type { OHLCCandle } from '../types/market'
import type { Signal } from '../rules/engine'
import {
  createRaceState,
  parseRaceState,
  stepStrategy,
  syncRaceState,
  type MarketTick,
} from './live'
import { FIB_NO_CHASE, LAB_BOTS, labCheck, newsCloseDue } from './labBots'
import { parseFfWeek } from './newsFeed'
import { parseYahooChart } from './feeds'
import { newsWindows } from '../lab/news'

const H = 3600
const bar = (time: number, o: number, h: number, l: number, c: number): OHLCCandle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: c,
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
  market: 'pax-gold',
  signal: null,
  path: [bar(4000, 100, 100, 100, 100)],
  price: 100,
  usdPerQuote: 1,
  feeRate: 0.001,
  leverage: 20,
  ...over,
})
const fresh = () => createRaceState([{ id: 'a', name: 'A' }], 10_000, 1).strategies.a

describe('lab bots in the live race', () => {
  const opened = (over: Partial<MarketTick> = {}) =>
    stepStrategy(fresh(), [tick({ signal: sig(), ...over })], 5000).strategy

  it('a first target closes half; the rest goes on to the target', () => {
    const s = opened({ target1: 105 })
    expect(s.open[0]).toMatchObject({ target1: 105, part1: 0.5 })
    const units = s.open[0].units // $200 at a $5 stop = 40 oz
    expect(units).toBeCloseTo(40)
    const r = stepStrategy(s, [tick({ path: [bar(4000 + H, 100, 106, 99, 105)] })], 9000)
    expect(r.closed).toHaveLength(1)
    expect(r.closed[0]).toMatchObject({ reason: 'target', exit: 105, part1Of: 0.5 })
    expect(r.closed[0].units).toBeCloseTo(20)
    expect(r.strategy.open[0].units).toBeCloseTo(20)
    expect(r.strategy.open[0].target1).toBeUndefined()
    const done = stepStrategy(
      r.strategy,
      [tick({ path: [bar(4000 + 2 * H, 105, 111, 104, 110)] })],
      12_000,
    )
    expect(done.closed[0]).toMatchObject({ reason: 'target', exit: 110 })
    expect(done.strategy.open).toHaveLength(0)
    // 20 oz x $5 + 20 oz x $10, minus fees
    const net = r.closed[0].pnl + done.closed[0].pnl
    expect(net).toBeGreaterThan(290)
    expect(net).toBeLessThan(300)
  })

  it('first target and target in one candle both fill', () => {
    const r = stepStrategy(
      opened({ target1: 105 }),
      [tick({ path: [bar(4000 + H, 100, 111, 99, 110)] })],
      9000,
    )
    expect(r.closed.map((c) => c.reason)).toEqual(['target', 'target'])
    expect(r.strategy.open).toHaveLength(0)
  })

  it('a deadline closes at the open of the first candle at or after it', () => {
    const s = opened({ deadline: 4000 + 2 * H })
    const r = stepStrategy(
      s,
      [tick({ path: [bar(4000 + H, 100, 101, 99, 100), bar(4000 + 2 * H, 102, 103, 101, 102)] })],
      4000 + 2 * H + 60,
    )
    expect(r.closed[0]).toMatchObject({ reason: 'time', exit: 102 })
  })

  it('past the deadline with no later candle: closes at the price, but not on a stale (weekend) feed', () => {
    const s = opened({ deadline: 5000 })
    const live = stepStrategy(
      s,
      [tick({ path: [bar(4000, 100, 100, 100, 100)], price: 101 })],
      6000,
    )
    expect(live.closed[0]).toMatchObject({ reason: 'time', exit: 101 })
    const stale = stepStrategy(
      s,
      [tick({ path: [bar(4000, 100, 100, 100, 100)], price: 101 })],
      4000 + 3 * H,
    )
    expect(stale.closed).toHaveLength(0)
  })

  it('closeNow closes open trades before red news', () => {
    const r = stepStrategy(opened(), [tick({ closeNow: true, price: 99 })], 6000)
    expect(r.closed[0]).toMatchObject({ reason: 'news', exit: 99 })
  })

  it('a buy whose price already passed the first target does not open', () => {
    const r = stepStrategy(fresh(), [tick({ signal: sig(), target1: 99 })], 5000)
    expect(r.opened).toHaveLength(0)
  })

  it('the five join a running race with fresh money; nothing else changes', () => {
    const base = createRaceState([{ id: 'x', name: 'X' }], 10_000, 1)
    base.strategies.x.balance = 10_123.45
    base.strategies.x.open = stepStrategy(fresh(), [tick({ signal: sig() })], 5000).strategy.open
    const { state, changes } = syncRaceState(base, [
      { id: 'x', name: 'X' },
      ...LAB_BOTS.map((b) => ({ id: b.id, name: b.name })),
    ])
    expect(changes).toHaveLength(5)
    expect(state.strategies.x).toEqual(base.strategies.x)
    for (const b of LAB_BOTS) expect(state.strategies[b.id].balance).toBe(10_000)
    // A state with first targets, deadlines and the new exit reasons still parses.
    const r = stepStrategy(
      opened({ target1: 105, deadline: 99_999 }),
      [tick({ path: [bar(4000 + H, 100, 106, 99, 105)] })],
      9000,
    )
    const parsed = parseRaceState({ ...state, strategies: { ...state.strategies, a: r.strategy } })
    expect(parsed.ok).toBe(true)
  })
})

describe('lab bot checks', () => {
  const rsi = LAB_BOTS.find((b) => b.id === 'lab-rsi-us30')!
  const fib = LAB_BOTS.find((b) => b.id === 'lab-fib-eurusd-4h')!
  const day = LAB_BOTS.find((b) => b.id === 'lab-fib-london-us30')!
  // Wednesday 2026-07-01 12:00 UTC.
  const NOW = Date.UTC(2026, 6, 1, 12) / 1000

  it('the five are the lab top 5 with their in-sample settings', () => {
    expect(LAB_BOTS.map((b) => b.labId)).toEqual([
      'rsi-range-reversal|1h-race|US30|block',
      'fib|4h-swing|EURUSD|off',
      'mfx-ema-12-36-pullback|4h-race|XAUUSD|block',
      'fib-london|1h-day|US30|close',
      'mm-stop-hunt-reversal|1h-race|XAUUSD|close',
    ])
  })

  it('news: block opens nothing inside a window; close also closes before one', () => {
    const ev = [{ time: NOW + 10 * 60, currency: 'USD', event: 'CPI m/m' }]
    const w = newsWindows(ev, ['USD'], 'block')
    expect(labCheck(rsi, [], NOW, 50_000, w).note).toMatch(/red news/)
    const wc = newsWindows(ev, ['USD'], 'close')
    expect(newsCloseDue(day, wc, NOW - 2 * H)).toBe(false)
    expect(newsCloseDue(day, wc, NOW - 40 * 60)).toBe(true) // window starts 20 min before the event
    expect(newsCloseDue(rsi, wc, NOW)).toBe(false) // a "block" bot never closes for news
  })

  it('day trades: nothing new after 16:00 New York, deadline 17:00 New York', () => {
    const late = Date.UTC(2026, 6, 1, 20, 30) / 1000 // 16:30 EDT
    expect(labCheck(day, [], late, 50_000, []).note).toMatch(/16:00/)
    expect(labCheck(day, [], NOW, 50_000, []).deadline).toBe(Date.UTC(2026, 6, 1, 21) / 1000)
  })

  it("John's Fib: a level touched on the last closed candle opens near the level, not after it ran", () => {
    // 4h candles: quiet, a drop of about 10 ATR, then a pullback that touches 0.786.
    const T = Date.UTC(2026, 5, 1) / 1000
    const c: OHLCCandle[] = []
    for (let i = 0; i < 20; i++)
      c.push(bar(T + i * 4 * H, 1.1, 1.1005, 1.0995, 1.1 + (i % 2 ? 0.0002 : -0.0002)))
    c.push(bar(T + 20 * 4 * H, 1.1, 1.101, 1.0998, 1.1008)) // last bullish candle: 1 = 1.101
    c.push(bar(T + 21 * 4 * H, 1.1008, 1.1009, 1.096, 1.0962))
    c.push(bar(T + 22 * 4 * H, 1.0962, 1.0963, 1.091, 1.0912)) // 0 = 1.091
    c.push(bar(T + 23 * 4 * H, 1.0912, 1.0995, 1.0911, 1.099)) // up to 1.0995: 0.786 = 1.09886
    const level = 1.091 + 0.786 * (1.101 - 1.091)
    const ok = labCheck(fib, c, NOW, level - 0.0002, [])
    expect(ok.signal).toMatchObject({
      direction: 'short',
      stop: expect.any(Number),
      target1: 1.091,
    })
    expect(ok.signal!.entry).toBeCloseTo(level, 6)
    const ran = labCheck(fib, c, NOW, level - (FIB_NO_CHASE + 0.05) * (level - 1.091), [])
    expect(ran.signal).toBeNull()
    expect(ran.note).toMatch(/no chase/)
  })
})

describe('feeds', () => {
  it('Forex Factory weekly feed: High impact only, times with their offset', () => {
    const ev = parseFfWeek([
      { title: 'CPI m/m', country: 'USD', date: '2026-11-10T08:30:00-05:00', impact: 'High' },
      {
        title: 'Unemployment Claims',
        country: 'USD',
        date: '2026-11-12T08:30:00-05:00',
        impact: 'Medium',
      },
      { title: 'bad', country: 'USD', date: 'x', impact: 'High' },
    ])
    expect(ev).toEqual([
      { time: Date.UTC(2026, 10, 10, 13, 30) / 1000, currency: 'USD', event: 'CPI m/m' },
    ])
    expect(parseFfWeek({ not: 'a list' })).toEqual([])
  })
  it('Yahoo chart: drops missing prices and the off-grid latest-quote row', () => {
    const t0 = Date.UTC(2026, 10, 11, 5) / 1000
    const c = parseYahooChart(
      {
        chart: {
          result: [
            {
              timestamp: [t0, t0 + H, t0 + 2 * H, t0 + 2 * H + 1693],
              indicators: {
                quote: [
                  {
                    open: [1, null, 3, 4],
                    high: [1, 2, 3, 4],
                    low: [1, 2, 3, 4],
                    close: [1, 2, 3, 4],
                  },
                ],
              },
            },
          ],
        },
      },
      H,
    )
    expect(c.map((x) => x.time)).toEqual([t0, t0 + 2 * H])
    expect(() => parseYahooChart({}, H)).toThrow()
  })
})
