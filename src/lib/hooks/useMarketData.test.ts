import { describe, it, expect } from 'vitest'
import { transformCryptoPrices, transformForexRates, FOREX_PAIRS } from './useMarketData'
import { COIN_MAP } from '../coingecko'

describe('transformCryptoPrices', () => {
  it('returns [] for undefined input', () => {
    expect(transformCryptoPrices(undefined)).toEqual([])
  })

  it('shapes every coin in COIN_MAP even if missing from the response', () => {
    const ids = Object.keys(COIN_MAP)
    const out = transformCryptoPrices({})
    expect(out).toHaveLength(ids.length)
    expect(out.every((c) => c.price === 0 && c.change24h === 0)).toBe(true)
  })

  it('maps fields from CoinGecko rows', () => {
    const out = transformCryptoPrices({
      bitcoin: {
        usd: 65000,
        usd_24h_change: 2.5,
        usd_24h_vol: 1_000_000,
        usd_market_cap: 1_300_000_000,
      },
    })
    const btc = out.find((c) => c.id === 'bitcoin')
    expect(btc).toMatchObject({ symbol: 'BTC', price: 65000, change24h: 2.5 })
    expect(btc?.type).toBe('crypto')
  })
})

describe('transformForexRates', () => {
  it('returns [] for undefined input', () => {
    expect(transformForexRates(undefined)).toEqual([])
  })

  it('inverts base pairs (EUR/USD = 1/EUR when EUR is given vs USD)', () => {
    const out = transformForexRates({
      EUR: 0.8,
      GBP: 0.75,
      JPY: 150,
      CHF: 0.9,
      AUD: 1.5,
      CAD: 1.35,
      NZD: 1.6,
    })
    const eurusd = out.find((p) => p.symbol === 'EUR/USD')
    expect(eurusd?.price).toBeCloseTo(1 / 0.8, 5)
  })

  it('uses the quote rate directly for non-inverted pairs', () => {
    const out = transformForexRates({
      EUR: 0.8,
      GBP: 0.75,
      JPY: 150,
      CHF: 0.9,
      AUD: 1.5,
      CAD: 1.35,
      NZD: 1.6,
    })
    const usdjpy = out.find((p) => p.symbol === 'USD/JPY')
    expect(usdjpy?.price).toBe(150)
  })

  it('crosses non-USD pairs (EUR/GBP = GBP per USD / EUR per USD)', () => {
    const out = transformForexRates({ EUR: 0.892, GBP: 0.745, JPY: 158 })
    expect(out.find((p) => p.symbol === 'EUR/GBP')?.price).toBeCloseTo(0.835, 3)
    expect(out.find((p) => p.symbol === 'GBP/USD')?.price).toBeCloseTo(1 / 0.745, 5)
    // A currency missing from the feed gives no price, not a made-up 1.
    expect(out.find((p) => p.symbol === 'USD/CAD')?.price).toBe(0)
  })

  it('emits one entry per configured FOREX_PAIRS', () => {
    const out = transformForexRates({
      EUR: 0.8,
      GBP: 0.75,
      JPY: 150,
      CHF: 0.9,
      AUD: 1.5,
      CAD: 1.35,
      NZD: 1.6,
    })
    expect(out).toHaveLength(FOREX_PAIRS.length)
  })

  it('id replaces / with - (matches watchlist format)', () => {
    const out = transformForexRates({
      EUR: 0.8,
      GBP: 0.75,
      JPY: 150,
      CHF: 0.9,
      AUD: 1.5,
      CAD: 1.35,
      NZD: 1.6,
    })
    expect(out.find((p) => p.symbol === 'EUR/USD')?.id).toBe('EUR-USD')
  })
})
