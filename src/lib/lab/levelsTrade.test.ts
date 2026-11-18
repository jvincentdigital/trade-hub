import { describe, expect, it } from 'vitest'
import { MARKET_COSTS } from './harmonicFind'
import { tradeB0, tradeT0, tradeT1, walkExit } from './levelsTrade'
import type { LevelsCtx, Touch } from './levelsWatch'
import { barsOf, ctxOf } from './levelsTestKit'

// ATR 10 (quick target 2.5, hold target 10, T0 stop far + 2.5, B0 at far + 1).
// Test costs: spread 0.5, 0.5 pip = 0.25, 0.2 pip = 0.125, no commission, pip 1.
const T = Date.UTC(2015, 0, 5, 12) / 1000
const H = 3600

const visit = (over: Partial<Touch> = {}): Touch => ({
  touch: 0,
  dir: 1,
  near: 100,
  far: 100,
  atr: 10,
  g: 2.5,
  end: 50,
  endKind: 1,
  turns: 0,
  seq: 1,
  ...over,
})

const ex = (t: ReturnType<typeof tradeT0>, k: number) => {
  const x = t.exits[k]
  return [x.how, x.at, x.price, x.after, x.before, x.double]
}

describe('T0, an order at the level', () => {
  it('a sell at a ceiling: fills at the near edge when the Bid is 0.5 pip through; the sell pays the spread', () => {
    const ctx = ctxOf(
      barsOf([
        [100, 100.2, 99, 100], // touch: 100.2 < 100.25, no fill
        [101, 101, 99, 100], // fill at 100 (never better, though it opened at 101); only the stop is tested
        [100, 100, 96.9, 97], // quick target 97.5: Bid low + 0.5 = 97.4 <= 97.5
        [99, 102, 99, 100], // hold: stop 102.5 hit by Bid high + 0.5 = 102.5; opened at 99, fills at 102.5
      ]),
    )
    const t = tradeT0(ctx, visit())
    expect([t.status, t.dir, t.fill, t.entry, t.stop, t.R, t.spread]).toEqual([
      'trade',
      -1,
      1,
      100,
      102.5,
      2.5,
      0.5,
    ])
    // Quick: +2.5 in price, no market fill: 1 R; before costs + 0.5 / 2.5; double - 0.5 / 2.5.
    expect(ex(t, 0)).toEqual(['target', 2, 97.5, 1, 1.2, 0.8])
    // Hold: -2.5 and one market fill (0.125): -1.05 R; costs 0.625.
    expect(ex(t, 1)).toEqual(['stop', 3, 102.5, -1.05, -0.8, -1.3])
  })

  it('a buy at a floor: fills when the Bid low plus the spread is 0.5 pip through', () => {
    const ctx = ctxOf(
      barsOf([
        [100, 101, 99.3, 100], // touch from above; 99.3 + 0.5 = 99.8 > 99.75
        [100, 100, 99.25, 99.5], // 99.25 + 0.5 = 99.75: fills at 100 (the Ask)
        [100, 102.5, 99.5, 102], // quick target 102.5 (Bid high)
        [97, 98, 96, 97], // hold: stop 97.5 (Bid low); opened at 97, below it: fills at 97
      ]),
    )
    const t = tradeT0(ctx, visit({ dir: -1 }))
    expect([t.status, t.dir, t.fill, t.entry, t.stop, t.R]).toEqual(['trade', 1, 1, 100, 97.5, 2.5])
    expect(ex(t, 0)).toEqual(['target', 2, 102.5, 1, 1.2, 0.8])
    // -3 and a market fill: (-3.125) / 2.5.
    expect(ex(t, 1)).toEqual(['stop', 3, 97, -1.25, -1, -1.5])
  })

  it('works only through the visit end minute; skipped when R is under 5 x its round-trip cost', () => {
    const ctx = ctxOf(
      barsOf([
        [100, 100, 99, 100],
        [100, 100.1, 99, 100],
        [100, 101, 99, 100],
      ]),
    )
    expect(tradeT0(ctx, visit({ end: 1 })).status).toBe('no_fill')
    expect(tradeT0(ctx, visit({ end: 2 })).fill).toBe(2)
    // ATR 1.9: R = 0.475 < 5 x 0.5.
    expect(tradeT0(ctx, visit({ atr: 1.9 })).status).toBe('skip_r')
  })

  it('gold: the spread is $0.28 x X / $1,800 at the order price, and $0.07 a trade', () => {
    const ctx: LevelsCtx = {
      ...ctxOf(
        barsOf([
          [1800, 1800.04, 1799, 1800],
          [1800, 1800.05, 1799, 1800],
          [1799, 1799.5, 1796, 1797],
        ]),
      ),
      costs: MARKET_COSTS.XAUUSD,
    }
    const t = tradeT0(ctx, visit({ near: 1800, far: 1800 }))
    expect([t.fill, t.entry, t.stop, t.R]).toEqual([1, 1800, 1802.5, 2.5])
    expect(t.spread).toBeCloseTo(0.28, 12)
    // Quick target 1797.5: Bid low 1796 + 0.28 <= 1797.5. +2.5 - 0.07.
    expect(t.exits[0].how).toBe('target')
    expect(t.exits[0].after).toBeCloseTo((2.5 - 0.07) / 2.5, 12)
    expect(t.exits[0].before).toBeCloseTo((2.5 + 0.28) / 2.5, 12)
  })
})

describe('T1, after price closes back out', () => {
  // 15-minute candles from T (12:00 UTC). Touch at T + 300 on the ceiling band [100, 101].
  const times = [T + 300, T + 600, T + 900, T + 2700, T + 2760, T + 2820]
  const rows = [
    [100, 100.5, 99.8, 100.2], // touch
    [100, 102, 100, 100], // candle 1 closes at 100 > 99.5: no trigger
    [100, 100.4, 99, 99.4], // candle 2 closes at 99.4 <= 100 - 0.5: the trigger
    [99, 99.2, 95, 99], // entry at the open 99 (> 97.5); only the stop in this minute
    [98, 98, 95.9, 96], // quick target 96.5: 95.9 + 0.5 <= 96.5
    [99, 102.6, 99, 100], // hold: stop 103 = max(101, 102) + 1, hit by 102.6 + 0.5
  ]
  it('a sell: the first of eight 15-minute candles to close 0.05 x ATR back, entry at the next open', () => {
    const ctx = ctxOf(barsOf(rows, times))
    const t = tradeT1(ctx, visit({ far: 101 }))
    expect([t.status, t.dir, t.fill, t.entry, t.stop, t.R, t.spread]).toEqual([
      'trade',
      -1,
      3,
      99,
      103,
      4,
      0.5,
    ])
    // +2.5 and the entry's market fill: 2.375 / 4.
    expect(ex(t, 0)).toEqual(['target', 4, 96.5, 0.59375, 0.75, 0.4375])
    // -4 and two market fills.
    expect(ex(t, 1)).toEqual(['stop', 5, 103, -1.0625, -0.875, -1.25])
  })

  it('no trade if the far edge + 0.25 x ATR was reached; skipped if the entry opens 0.25 x ATR back', () => {
    const broke = rows.map((r, i) => (i === 1 ? [100, 103.5, 100, 100] : r))
    expect(tradeT1(ctxOf(barsOf(broke, times)), visit({ far: 101 })).status).toBe('broke')
    const gap = rows.map((r, i) => (i === 3 ? [97.5, 99.2, 95, 99] : r))
    expect(tradeT1(ctxOf(barsOf(gap, times)), visit({ far: 101 })).status).toBe('skip_open')
    // None of the eight candles closes back out.
    const flat = Array.from({ length: 12 }, () => [100, 100.2, 99.8, 100])
    const ft = flat.map((_, i) => T + 300 + 900 * i)
    const t = tradeT1(ctxOf(barsOf(flat, ft)), visit({ far: 101 }))
    expect([t.status, t.done]).toEqual(['no_trigger', 8])
  })

  it('gold: T1 spread is $0.28 x the Bid open of the entry minute / $1,800', () => {
    const ctx: LevelsCtx = { ...ctxOf(barsOf(rows, times)), costs: MARKET_COSTS.XAUUSD }
    const t = tradeT1(ctx, visit({ far: 101 }))
    expect([t.status, t.entry]).toEqual(['trade', 99])
    expect(t.spread).toBeCloseTo((0.28 * 99) / 1800, 15)
  })

  it('a buy mirrors it: entry at the Ask, the stop below the lower of the far edge and the lowest low', () => {
    // A floor [99, 100] from above: trigger close >= 100.5, entry Ask = open + 0.5, stop min(99, 98) - 1.
    const mirror = [
      [100, 100.2, 99.5, 99.8],
      [100, 100, 98, 100],
      [100, 101, 99.6, 100.6],
      [101, 105, 100.9, 101],
      [102, 104.1, 101, 104],
    ]
    const ctx = ctxOf(barsOf(mirror, times.slice(0, 5)))
    const t = tradeT1(ctx, visit({ dir: -1, near: 100, far: 99 }))
    expect([t.status, t.dir, t.fill, t.entry, t.stop, t.R]).toEqual(['trade', 1, 3, 101.5, 97, 4.5])
    // Quick target 104: not in the fill minute (105), hit the next minute.
    expect(ex(t, 0).slice(0, 3)).toEqual(['target', 4, 104])
  })
})

describe('B0, with the break', () => {
  it('a buy stop at P = far + 0.1 x ATR: fills at P or the opening Ask if higher; stop 0.25 x ATR below', () => {
    const ctx = ctxOf(
      barsOf([
        [100, 100.4, 99, 100], // touch: 100.4 + 0.5 < 101
        [100.8, 101, 100, 100.5], // 101 + 0.5 >= 101: entry max(101, 100.8 + 0.5) = 101.3
        [98, 99, 97, 98], // stop 98.8: opened at 98, below it: fills at 98
      ]),
    )
    const t = tradeB0(ctx, visit())
    expect([t.status, t.dir, t.fill, t.entry, t.stop, t.R]).toEqual([
      'trade',
      1,
      1,
      101.3,
      98.8,
      2.5,
    ])
    // R 2.5 = 5 x 0.5 exactly: not under, so kept. -3.3 and two market fills.
    expect(t.exits[0].how).toBe('stop')
    expect(t.exits[0].price).toBe(98)
    expect(t.exits[0].after).toBeCloseTo((98 - 101.3 - 0.25) / 2.5, 12)
  })

  it('a sell stop at P = far - 0.1 x ATR; its stop is hit when the Bid high plus the spread reaches it', () => {
    const ctx = ctxOf(
      barsOf([
        [100, 101, 99.5, 100],
        [99.5, 99.5, 98.5, 99], // low 98.5 <= 99: entry min(99, 99.5) = 99; stop 101.5
        [100, 101, 99, 100], // 101 + 0.5 >= 101.5: the stop, at 101.5
      ]),
    )
    const t = tradeB0(ctx, visit({ dir: -1 }))
    expect([t.status, t.dir, t.fill, t.entry, t.stop]).toEqual(['trade', -1, 1, 99, 101.5])
    expect(ex(t, 0)).toEqual(['stop', 2, 101.5, -1.1, -0.8, -1.4])
  })

  it('works through the visit end and earlier than 24 hours after the touch', () => {
    const b = barsOf(
      [
        [100, 100, 99, 100],
        [100, 101, 99, 100],
      ],
      [T, T + 24 * H],
    )
    expect(tradeB0(ctxOf(b), visit({ end: 1 })).status).toBe('no_fill')
  })
})

describe('exits and the end of the data', () => {
  it('a stop and a target in one minute count as the stop; the time exit closes at the open first', () => {
    const ctx = ctxOf(
      barsOf([
        [100, 100, 100, 100],
        [100, 103, 97, 100],
      ]),
    )
    expect(walkExit(ctx, 1, 0, 98, 102, 0.5, -1)).toEqual({ how: 'stop', at: 1, price: 98 })
    const t = ctxOf(
      barsOf(
        [
          [100, 100, 100, 100],
          [101, 103, 97, 100],
        ],
        [T, T + 24 * H],
      ),
    )
    expect(walkExit(t, 1, 0, 98, 102, 0.5, 1)).toEqual({ how: 'time', at: 1, price: 101 })
    expect(walkExit(t, -1, 0, 102, 98, 0.5, 1)).toEqual({ how: 'time', at: 1, price: 101.5 })
  })

  it('a stop fills at its level, or at the open when the open is already beyond it (a sell: the Ask)', () => {
    const ctx = ctxOf(
      barsOf([
        [100, 100, 100, 100],
        [103, 104, 102, 103],
        [100, 103, 99, 100],
      ]),
    )
    // A sell with its stop at 102: the minute opens at 103 + 0.5, beyond it.
    expect(walkExit(ctx, -1, 0, 102, 95, 0.5, -1)).toEqual({ how: 'stop', at: 1, price: 103.5 })
    // With its stop at 104: Bid high 104 + 0.5 reaches it, the open 103.5 does not: at 104.
    expect(walkExit(ctx, -1, 0, 104, 95, 0.5, -1)).toEqual({ how: 'stop', at: 1, price: 104 })
  })

  it('a trade still open closes at the last close (a sell: plus the spread), after that minute tests, as a market fill', () => {
    const rows = [
      [100, 100.3, 99, 100], // T0 sell fills at 100
      [100, 100.5, 99.5, 100],
      [100, 100.5, 99.5, 99], // last minute: no stop or target; closes at 99 + 0.5
    ]
    const t = tradeT0(ctxOf(barsOf(rows)), visit())
    expect(ex(t, 0)).toEqual(['end', 2, 99.5, 0.15, 0.4, -0.1])
    expect([t.done, t.exits[0].done]).toEqual([-1, -1])
    const b = ctxOf(
      barsOf([
        [100, 100, 100, 100],
        [100, 101, 99, 100.25],
      ]),
    )
    expect(walkExit(b, 1, 0, 98, 102, 0.5, -1)).toEqual({ how: 'end', at: 1, price: 100.25 })
  })
})

describe('the exit walk against the plan read word for word', () => {
  it('agrees on random minutes for buys and sells, with and without a time exit', () => {
    let seed = 777
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let trial = 0; trial < 400; trial++) {
      const rows: number[][] = []
      let p = 100
      for (let i = 0; i < 60; i++) {
        const o = p
        p += (Math.floor(rnd() * 9) - 4) / 4
        const h = Math.max(o, p) + Math.floor(rnd() * 4) / 4
        const l = Math.min(o, p) - Math.floor(rnd() * 4) / 4
        rows.push([o, h, l, p])
      }
      const ctx = ctxOf(barsOf(rows))
      const dir = rnd() < 0.5 ? 1 : -1
      const fill = Math.floor(rnd() * 20)
      const stop = 100 - dir * (1 + Math.floor(rnd() * 12) / 4)
      const target = 100 + dir * (1 + Math.floor(rnd() * 12) / 4)
      const ti = rnd() < 0.5 ? -1 : fill + 1 + Math.floor(rnd() * 40)
      const sp = 0.5
      const { open, high, low, close } = ctx.bars
      let want: { how: string; at: number; price: number } | null = null
      for (let m = fill; m < ctx.n && !want; m++) {
        if (m === ti) want = { how: 'time', at: m, price: dir === 1 ? open[m] : open[m] + sp }
        else if (dir === 1 && low[m] <= stop)
          want = { how: 'stop', at: m, price: open[m] < stop ? open[m] : stop }
        else if (dir === -1 && high[m] + sp >= stop)
          want = { how: 'stop', at: m, price: open[m] + sp > stop ? open[m] + sp : stop }
        else if (m > fill && dir === 1 && high[m] >= target)
          want = { how: 'target', at: m, price: target }
        else if (m > fill && dir === -1 && low[m] + sp <= target)
          want = { how: 'target', at: m, price: target }
      }
      want ??= {
        how: 'end',
        at: ctx.n - 1,
        price: dir === 1 ? close[ctx.n - 1] : close[ctx.n - 1] + sp,
      }
      expect(walkExit(ctx, dir, fill, stop, target, sp, ti < ctx.n ? ti : -1)).toEqual(want)
    }
  })
})
