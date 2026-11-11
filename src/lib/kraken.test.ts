import { describe, expect, it } from 'vitest'
import { capSpikes, KRAKEN_PAIRS, parseKrakenOHLC } from './kraken'

// Shape copied from a real reply (2026-11-10): the result key is Kraken's own
// pair name (XXBTZUSD for XBTUSD), next to `last`; numbers come as strings.
const reply = {
  error: [],
  result: {
    XXBTZUSD: [
      [1791741600, '83750.1', '83821.8', '83493.7', '83590.9', '83713.7', '77.41991906', 4488],
      [1791745200, '83590.9', '83600.0', '83400.2', '83450.0', '83500.1', '12.5', 900],
    ],
    last: 1791741600,
  },
}

describe('parseKrakenOHLC', () => {
  it('reads candles under whatever pair key Kraken uses', () => {
    const c = parseKrakenOHLC(reply)
    expect(c).toHaveLength(2)
    expect(c[0]).toEqual({
      time: 1791741600,
      open: 83750.1,
      high: 83821.8,
      low: 83493.7,
      close: 83590.9,
    })
    expect(c[1].high).toBeGreaterThan(c[1].low)
    const other = { error: [], result: { XDGUSD: reply.result.XXBTZUSD, last: 1 } }
    expect(parseKrakenOHLC(other)).toHaveLength(2)
  })

  it('throws on a Kraken error or a wrong shape', () => {
    expect(() => parseKrakenOHLC({ error: ['EGeneral:Too many requests'] })).toThrow(
      /Too many requests/,
    )
    expect(() => parseKrakenOHLC({ error: [], result: { last: 1 } })).toThrow(/schema/)
    expect(() => parseKrakenOHLC({ nope: true })).toThrow(/schema/)
  })

  it('has a pair for every coin, gold and the forex pairs Kraken trades well', () => {
    expect(Object.keys(KRAKEN_PAIRS)).toHaveLength(17)
    expect(KRAKEN_PAIRS['GBP-USD']).toBe('GBPUSD')
    // Kraken's yen book is too thin to trust (docs/london-open.md).
    expect(KRAKEN_PAIRS['USD-JPY']).toBeUndefined()
    expect(KRAKEN_PAIRS['pax-gold']).toBe('PAXGUSD')
    expect(KRAKEN_PAIRS.dogecoin).toBe('XDGUSD')
  })
})

describe('capSpikes (thin Kraken forex books)', () => {
  /** 100 quiet 15m candles `w` wide around `p`. */
  const quiet = (p: number, w: number) =>
    Array.from({ length: 100 }, (_, i) => ({
      time: i * 900,
      open: p,
      high: p + w / 2,
      low: p - w / 2,
      close: p,
    }))
  const last = <T>(a: T[]) => a[a.length - 1]

  it('caps the real AUD/USD print at 00:45 UTC on 2026-11-11 (high 0.7977)', () => {
    const bg = quiet(0.687, 0.0004) // 4 pips: median range 0.058%, so the cap is 0.58%
    const out = capSpikes([
      ...bg,
      { time: 90_000, open: 0.68733, high: 0.7977, low: 0.68727, close: 0.68772 },
    ])
    expect(last(out).high).toBeCloseTo(0.68772 * (1 + (10 * 0.0004) / 0.687), 8)
    expect(last(out).high).toBeLessThan(0.692)
    expect(last(out).low).toBe(0.68727) // a normal wick stays
    expect(out.slice(0, -1)).toEqual(bg)
  })

  it('caps the GBP/USD print at 20:00 UTC on 2026-11-08 (high 1.3539, about 200 pips)', () => {
    const out = capSpikes([
      ...quiet(1.3337, 0.0005),
      { time: 90_000, open: 1.33367, high: 1.3539, low: 1.33325, close: 1.33381 },
    ])
    // Median range 0.037%, so the cap is 0.37%: the 200-pip wick becomes about 50 pips.
    expect(last(out).high).toBeCloseTo(1.33381 * (1 + (10 * 0.0005) / 1.3337), 8)
    expect(last(out).high).toBeLessThan(1.3389)
  })

  it('caps low spikes too (EUR/GBP 13:45 UTC on 2026-11-10, low 0.8272)', () => {
    const out = capSpikes([
      ...quiet(0.835, 0.0001),
      { time: 90_000, open: 0.835, high: 0.83518, low: 0.8272, close: 0.83518 },
    ])
    // Median range 0.012%: 10x is under the 0.3% floor, so the floor is the cap.
    expect(last(out).low).toBeCloseTo(0.835 * 0.997, 8)
    expect(last(out).high).toBe(0.83518)
  })
})
