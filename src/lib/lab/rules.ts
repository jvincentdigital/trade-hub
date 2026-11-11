// Strategy lab: the race's built-in rules (src/lib/rules), signals from the
// race's own engine, traded by the lab engine with spread and slippage.
// The one free parameter is the target (rr x the stop distance). Pure.

import type { OHLCCandle } from '../types/market'
import { findSignals, type Signal } from '../rules/engine'
import { BUILT_IN_RULES } from '../rules/presets'
import type { Rule } from '../rules/schema'
import type { LabEntry } from './engine'
import type { LabMarketId, LabTf } from './markets'

export const LAB_RULES: Rule[] = BUILT_IN_RULES

export const labRule = (id: string): Rule => {
  const r = LAB_RULES.find((x) => x.id === id)
  if (!r) throw new Error(`unknown rule ${id}`)
  return r
}

/** Markets a rule trades in the lab (crypto-only rules: Bitcoin). */
export function ruleMarkets(rule: Rule, all: LabMarketId[]): LabMarketId[] {
  return rule.market === 'crypto' ? all.filter((m) => m === 'BTCUSDT') : all
}

export const ruleTf = (rule: Rule): LabTf => rule.timeframe

/** The rule's signals (computed once; the target is set per rr). */
export const ruleSignals = (rule: Rule, candles: OHLCCandle[]): Signal[] =>
  findSignals(rule, candles)

/** Enter at the next candle's open, stop as the rule says, target rr x the stop distance from the signal close. */
export function ruleEntries(signals: Signal[], rr: number, n: number): LabEntry[] {
  const out: LabEntry[] = []
  for (const s of signals) {
    if (s.index + 1 >= n) continue
    const risk = Math.abs(s.entry - s.stop)
    const long = s.direction === 'long'
    out.push({
      i: s.index + 1,
      kind: 'market',
      direction: s.direction,
      stop: s.stop,
      target: long ? s.entry + rr * risk : s.entry - rr * risk,
      signalTime: s.time,
    })
  }
  return out
}
