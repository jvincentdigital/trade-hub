import { describe, expect, it } from 'vitest'
import { createAccount, equityOf, FEE_RATE, LEVERAGE, placeOrder } from './engine'
import { getInstrument, instrumentHref, INSTRUMENTS } from './instruments'
import { ruleInstrumentIds } from '../rules/data'
import { BUILT_IN_RULES } from '../rules/presets'
import { isCoinGeckoId } from '../coingecko'
import { transformCryptoPrices, transformMetalPrices } from '../hooks/useMarketData'

const T0 = 1_700_000_000_000

describe('gold instrument', () => {
  it('is XAU/USD priced by PAX Gold, in its own metals group', () => {
    const g = getInstrument('pax-gold')
    expect(g).toMatchObject({ symbol: 'XAU/USD', market: 'metals', quote: 'USD' })
    expect(g?.label).toBe('Gold (XAU/USD)')
    expect(g?.note).toMatch(/PAX Gold/)
    expect(instrumentHref(g, 'pax-gold')).toBe('/gold')
    expect(isCoinGeckoId('pax-gold')).toBe(true)
    expect(INSTRUMENTS.filter((i) => i.market === 'metals')).toHaveLength(1)
  })

  it('stays out of the crypto price list but has its own price', () => {
    const raw = { bitcoin: { usd: 1 }, 'pax-gold': { usd: 4000, usd_24h_change: 0.5 } }
    expect(transformCryptoPrices(raw).some((p) => p.id === 'pax-gold')).toBe(false)
    expect(transformMetalPrices(raw)).toEqual([
      expect.objectContaining({ id: 'pax-gold', price: 4000, change24h: 0.5 }),
    ])
  })

  it('trades in the demo account with 20:1 margin and a 0.02% fee', () => {
    expect(LEVERAGE.metals).toBe(20)
    expect(FEE_RATE.metals).toBe(0.0002)
    const prices = { 'pax-gold': 4000 }
    const r = placeOrder(
      createAccount(10_000, T0),
      { instrumentId: 'pax-gold', side: 'long', type: 'market', units: 2, stopLoss: 3900 },
      prices,
      T0,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // $8,000 of gold locks $400 margin and pays $1.60 fee
    expect(r.account.cash).toBeCloseTo(10_000 - 400 - 1.6)
    expect(equityOf(r.account, { 'pax-gold': 4050 })).toBeCloseTo(10_000 - 1.6 + 100)
  })

  it('is traded by every all-markets rule, not by crypto-only ones', () => {
    for (const r of BUILT_IN_RULES) {
      const ids = ruleInstrumentIds(r, INSTRUMENTS)
      expect(ids.includes('pax-gold')).toBe(r.market === 'both')
    }
  })
})
