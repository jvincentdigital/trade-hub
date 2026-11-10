import { fetchCryptoCandles, fetchForexOHLC } from '../data'
import { getInstrument } from '../paper/instruments'
import type { OHLCCandle } from '../types/market'
import type { Rule, RuleTimeframe } from './schema'

export interface RuleCandles {
  candles: OHLCCandle[]
  /** Timeframe actually used (forex is always daily on the free feed). */
  tf: RuleTimeframe
  note: string | null
}

export const FOREX_DATA_NOTE =
  'Forex uses free daily ECB rates: daily candles only, highs and lows are estimated, so stops and targets in forex backtests are rough.'

export async function loadRuleCandles(rule: Rule, instrumentId: string): Promise<RuleCandles> {
  const inst = getInstrument(instrumentId)
  if (!inst) throw new Error('Unknown instrument')
  if (inst.market === 'forex') {
    return { candles: await fetchForexOHLC(inst.id, 365), tf: '1d', note: FOREX_DATA_NOTE }
  }
  return {
    candles: await fetchCryptoCandles(inst.id, rule.timeframe),
    tf: rule.timeframe,
    note: null,
  }
}

/** Instruments a rule may trade. */
export function ruleInstrumentIds(rule: Rule, all: { id: string; market: string }[]): string[] {
  if (rule.pairs.length) return rule.pairs
  return all.filter((i) => rule.market === 'both' || i.market === rule.market).map((i) => i.id)
}
