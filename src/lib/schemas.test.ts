import { describe, expect, it } from 'vitest'
import { cryptoPricesResponseSchema } from './schemas'

describe('cryptoPricesResponseSchema', () => {
  it('accepts null fields from CoinGecko instead of failing the whole feed', () => {
    const parsed = cryptoPricesResponseSchema.parse({
      bitcoin: { usd: 70_000, usd_24h_change: 1.2 },
      'matic-network': { usd: 0.12, usd_24h_change: null },
    })
    expect(parsed['matic-network'].usd_24h_change).toBeUndefined()
    expect(parsed.bitcoin.usd).toBe(70_000)
  })
})
