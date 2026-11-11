import { describe, expect, it } from 'vitest'
import { KRAKEN_PAIRS, parseKrakenOHLC } from './kraken'

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
