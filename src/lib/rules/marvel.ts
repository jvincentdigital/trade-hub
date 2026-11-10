import type { Rule } from './schema'

// Rules from the Market Maker Method course material, in our own words, each
// with the page or video + timestamp it came from. Written 2026-11-10 from
// the module 1 PDF; the video transcripts can refine these later via
// `make extract-strategies` (see docs/strategy-rules.md). Full notes:
// docs/strategies/marvel-fx-method.md.

const PDF = 'Market-Maker-Method-SquirrelFX.pdf (module 1)'

export const MARVEL_RULES: Rule[] = [
  {
    id: 'mm-stop-hunt-reversal',
    name: 'MM stop hunt reversal',
    summary:
      'The market maker runs the stops past the recent low (or high), leaves a W (or M), and a hammer or spike candle shows the trap is done. Enter at a session open, stop just past the stop-hunt extreme.',
    market: 'both',
    pairs: [],
    timeframe: '1h',
    direction: 'both',
    conditions: [
      { kind: 'formation' },
      {
        kind: 'pattern',
        names: [
          'Hammer',
          'Inverted Hammer',
          'Dragonfly Doji',
          'Bullish Engulfing',
          'Shooting Star',
          'Hanging Man',
          'Gravestone Doji',
          'Bearish Engulfing',
        ],
        lookback: 2,
      },
    ],
    stop: { kind: 'swing', lookback: 12, bufferPct: 0.15 },
    rr: 2,
    riskPct: 1,
    sessions: [
      { label: 'London open', start: 2.5, end: 4 },
      { label: 'NY open', start: 8.5, end: 10 },
    ],
    sources: [
      { label: PDF, at: 'p.27 (the four setups: stop hunt high M, stop hunt low W)' },
      {
        label: PDF,
        at: 'p.18 (hammer/spike at the NY open, stop about 15 pips past the low of day)',
      },
      { label: PDF, at: 'p.20 (stop hunt around the London open)' },
      { label: PDF, at: 'p.8 (50 EMA as first target; approximated here as 2R)' },
    ],
    builtIn: true,
  },
  {
    id: 'mm-three-level-exhaustion',
    name: 'MM three-day exhaustion',
    summary:
      'Price rarely runs the same way more than three days. After three daily candles in one direction, take the reversal candle the other way (buy the third-level drop, sell the third-level rise).',
    market: 'both',
    pairs: [],
    timeframe: '1d',
    direction: 'both',
    conditions: [
      { kind: 'streak', length: 3 },
      { kind: 'pattern', names: [], lookback: 1 },
    ],
    stop: { kind: 'swing', lookback: 4, bufferPct: 0.15 },
    rr: 2,
    riskPct: 0.5,
    sessions: [],
    sources: [
      { label: PDF, at: 'p.18 (no more than three days in one direction)' },
      { label: PDF, at: 'p.22 and p.25 (buy third-level corrections, sell third-level rises)' },
      { label: PDF, at: 'p.8 (a three-level run always brings a correction)' },
    ],
    builtIn: true,
  },
]
