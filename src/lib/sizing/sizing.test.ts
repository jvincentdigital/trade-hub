import { describe, expect, it } from 'vitest'
import { getInstrument } from '../paper/instruments'
import { sizeRaceTrade } from '../race/account'
import {
  fmtLots,
  perMoveText,
  pipSize,
  qty,
  rrText,
  sizeText,
  sizingLine,
  sizingOf,
  usdPerQuoteFor,
} from './sizing'

const GBPUSD = getInstrument('GBP-USD')
const USDJPY = getInstrument('USD-JPY')
const EURGBP = getInstrument('EUR-GBP')
const GOLD = getInstrument('pax-gold')
const BTC = getInstrument('bitcoin')

describe('pips and quote rates', () => {
  it('pip is 0.0001, 0.01 on JPY pairs, none for gold and crypto', () => {
    expect(pipSize(GBPUSD)).toBe(0.0001)
    expect(pipSize(USDJPY)).toBe(0.01)
    expect(pipSize(GOLD)).toBeNull()
    expect(pipSize(BTC)).toBeNull()
  })

  it('USD per quote unit: 1 for USD quotes, 1/price on USD/xxx, the USD pair on crosses', () => {
    expect(usdPerQuoteFor(GBPUSD, 1.3423)).toBe(1)
    expect(usdPerQuoteFor(USDJPY, 158.18)).toBeCloseTo(1 / 158.18)
    expect(usdPerQuoteFor(EURGBP, 0.87, { 'GBP-USD': 1.34 })).toBe(1.34)
    expect(usdPerQuoteFor(EURGBP, 0.87, {})).toBeNull()
  })
})

describe('the race example John checked (GBP/USD, 2% of $1,000)', () => {
  // entry 1.3423, stop 1.33315 = 91.5 pips; target 2x the stop distance
  const entry = 1.3423
  const stop = 1.33315
  const target = entry + 2 * (entry - stop)

  it('$20 risk is about 0.0219 lots, about $0.22 a pip', () => {
    const size = sizeRaceTrade({
      balance: 1000,
      open: [],
      entry,
      stop,
      usdPerQuote: 1,
      leverage: 30,
    })
    if (!size.ok) throw new Error(size.reason)
    const s = sizingOf({ inst: GBPUSD, units: size.units, entry, stop, target, usdPerQuote: 1 })
    expect(s.stopPips).toBeCloseTo(91.5)
    expect(s.riskUsd).toBeCloseTo(20)
    expect(s.units).toBeCloseTo(2185.8, 0)
    expect(s.lots).toBeCloseTo(0.02186, 4)
    // 0.1 lots = $1 a pip, so 0.0219 lots = $0.219 a pip; 91.5 pips x $0.219 = $20
    expect(s.perMoveUsd).toBeCloseTo(0.2186, 3)
    expect(s.perMoveUsd! * s.stopPips!).toBeCloseTo(20)
    expect(s.goalUsd).toBeCloseTo(40)
    expect(s.rr).toBeCloseTo(2)
    expect(sizeText(GBPUSD, s)).toBe('0.0219 lots (2,186 units)')
    expect(perMoveText(s)).toBe('$0.219 per pip')
    expect(sizingLine(GBPUSD, s)).toBe(
      '0.0219 lots (2,186 units) · $0.219 per pip · risk $20.00 · goal $40.00 · R:R 1:2',
    )
  })

  it('0.1 lots on EUR/USD-style pairs is $1 a pip', () => {
    const s = sizingOf({ inst: GBPUSD, units: 10_000, entry, usdPerQuote: 1 })
    expect(s.lots).toBeCloseTo(0.1)
    expect(s.perMoveUsd).toBeCloseTo(1)
    expect(s.riskUsd).toBeNull()
    expect(sizingLine(GBPUSD, s)).toBe('0.10 lots (10,000 units) · $1.00 per pip · no stop')
  })
})

describe('other markets', () => {
  it('USD/JPY: a pip is 0.01 yen, turned into dollars at the pair price', () => {
    const entry = 158.18
    const stop = 157.31867385
    const q = usdPerQuoteFor(USDJPY, entry)!
    const size = sizeRaceTrade({
      balance: 1000,
      open: [],
      entry,
      stop,
      usdPerQuote: q,
      leverage: 30,
    })
    if (!size.ok) throw new Error(size.reason)
    const s = sizingOf({ inst: USDJPY, units: size.units, entry, stop, usdPerQuote: q })
    expect(s.stopPips).toBeCloseTo(86.13, 1)
    expect(s.riskUsd).toBeCloseTo(20)
    expect(s.lots).toBeCloseTo(0.0367, 3)
    expect(s.perMoveUsd! * s.stopPips!).toBeCloseTo(20)
    // a USD-base pair's position value is its units
    expect(s.valueUsd).toBeCloseTo(s.units)
  })

  it('EUR/GBP: dollars per pip use GBP/USD', () => {
    const s = sizingOf({ inst: EURGBP, units: 100_000, entry: 0.87, usdPerQuote: 1.34 })
    expect(s.perMoveUsd).toBeCloseTo(13.4)
  })

  it('gold: lots of 100 oz and dollars per $1 move', () => {
    const s = sizingOf({
      inst: GOLD,
      units: 0.16308,
      entry: 4018.43,
      stop: 4141.066,
      target: 3805.678,
      usdPerQuote: 1,
    })
    expect(s.lots).toBeCloseTo(0.0016308)
    expect(s.perMoveUsd).toBeCloseTo(0.16308)
    expect(s.riskUsd).toBeCloseTo(20, 1)
    expect(sizeText(GOLD, s)).toBe('0.00163 lots (0.163 oz)')
    expect(perMoveText(s)).toBe('$0.163 per $1 move')
  })

  it('crypto: coins, no lots or per-move', () => {
    const s = sizingOf({ inst: BTC, units: 0.00153, entry: 100_000, stop: 98_000, usdPerQuote: 1 })
    expect(s.lots).toBeNull()
    expect(s.perMoveUsd).toBeNull()
    expect(s.riskUsd).toBeCloseTo(3.06)
    expect(sizeText(BTC, s)).toBe('0.00153 BTC')
  })

  it('formats', () => {
    expect(fmtLots(0.5)).toBe('0.50')
    expect(fmtLots(0.000304)).toBe('0.000304')
    expect(qty(5432.4)).toBe('5,432')
    expect(qty(12.345)).toBe('12.3')
    expect(rrText(1.5)).toBe('R:R 1:1.5')
    expect(rrText(null)).toBeNull()
  })
})
