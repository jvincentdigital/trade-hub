import type { Rule } from './schema'

// Built-in rules, written from our own strategy notes. Users duplicate one to
// tweak it; built-ins themselves are read-only so a backtest stays comparable.

const CRYPTO_PRIME = [
  { label: 'EU/US overlap', start: 8, end: 12 },
  { label: 'Asia open', start: 20, end: 24 },
]

export const BUILT_IN_RULES: Rule[] = [
  {
    id: 'mm-confluence-v2',
    name: 'MM Confluence v2',
    summary:
      'Wait for the market maker stop hunt (W/M), then enter with the trend when RSI is stretched and a reversal candle confirms.',
    market: 'crypto',
    pairs: [],
    timeframe: '4h',
    direction: 'both',
    conditions: [
      { kind: 'trend', period: 200 },
      { kind: 'formation' },
      { kind: 'rsi', period: 14, longBelow: 35, shortAbove: 65 },
      { kind: 'pattern', names: [], lookback: 2 },
    ],
    stop: { kind: 'swing', lookback: 10, bufferPct: 0.4 },
    rr: 2,
    riskPct: 1,
    sessions: CRYPTO_PRIME,
    sources: [{ label: 'docs/strategies/mm-confluence-v2.md (pillars 1-4, risk rules)' }],
    builtIn: true,
  },
  {
    id: 'ema50-pullback',
    name: 'EMA 50 pullback',
    summary:
      'Pillar 2, option 3 of MM Confluence on its own: in a trend, buy the clean bounce off the 50 EMA after a confirming candle.',
    market: 'both',
    pairs: [],
    timeframe: '4h',
    direction: 'both',
    conditions: [
      { kind: 'trend', period: 200 },
      { kind: 'emaTouch', period: 50, tolerancePct: 0.5 },
      { kind: 'pattern', names: [], lookback: 2 },
    ],
    stop: { kind: 'swing', lookback: 5, bufferPct: 0.3 },
    rr: 2,
    riskPct: 0.5,
    sessions: [],
    sources: [{ label: 'docs/strategies/mm-confluence-v2.md (pillar 2, option 3)' }],
    builtIn: true,
  },
  {
    id: 'rsi-range-reversal',
    name: 'RSI range reversal',
    summary:
      'Counter-move at the edge of the recent range: price at the 20-candle low/high, RSI stretched, reversal candle. A simple baseline to compare the others against.',
    market: 'both',
    pairs: [],
    timeframe: '1h',
    direction: 'both',
    conditions: [
      { kind: 'nearLevel', lookback: 20, tolerancePct: 0.5 },
      { kind: 'rsi', period: 14, longBelow: 30, shortAbove: 70 },
      { kind: 'pattern', names: [], lookback: 1 },
    ],
    stop: { kind: 'swing', lookback: 5, bufferPct: 0.3 },
    rr: 1.5,
    riskPct: 0.5,
    sessions: [],
    sources: [{ label: 'Baseline written 2026-11-10 for comparison' }],
    builtIn: true,
  },
]
