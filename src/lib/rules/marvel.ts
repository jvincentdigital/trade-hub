import type { Rule } from './schema'

// Rules from the Market Maker / Marvel FX Method course, in our own words,
// each with the PDF page or video + timestamp it came from. First written
// 2026-11-10 from the module 1 PDF; video sources added the same day from
// the first 8 transcribed videos (`make extract-strategies`, see
// docs/strategy-rules.md). Full notes: docs/strategies/marvel-fx-method.md.

const PDF = 'Market-Maker-Method-SquirrelFX.pdf (module 1)'
const NIVELES = 'Niveles MFXM (video)'
const PEAKS = 'PEAK FORMATIONS 1 (video)'
const MARCAR = 'Marcar Entradas Y Niveles (video)'
const NOTICIAS = 'Mejores Entradas despues de noticias (video)'
const EMA = 'Exponential Moving Average (video)'
const WEBINAR = 'sin titulo, daily webinar (video)'

const REVERSAL_CANDLES = {
  bullish: ['Hammer', 'Inverted Hammer', 'Dragonfly Doji', 'Bullish Engulfing'],
  bearish: ['Shooting Star', 'Hanging Man', 'Gravestone Doji', 'Bearish Engulfing'],
}

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
        names: [...REVERSAL_CANDLES.bullish, ...REVERSAL_CANDLES.bearish],
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
      { label: PEAKS, at: '20:22 (entries always come after a stop hunt)' },
      { label: PEAKS, at: '22:02 (after an upward stop hunt, sell the second leg)' },
      { label: MARCAR, at: '06:13 (pin at the day high leaving Asia, before NY)' },
      { label: MARCAR, at: '21:51 (hammer at 9:45 at the day high)' },
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
      { label: PEAKS, at: '10:06 (after the peak it falls for about three days)' },
      { label: WEBINAR, at: '30:04 (three days of falling = the third level)' },
      { label: NIVELES, at: '01:00 (after the third push, a longer pullback)' },
    ],
    builtIn: true,
  },
  {
    id: 'mfx-level3-peak-reversal',
    name: 'MFX level 3 peak reversal',
    summary:
      'After three pushes and a long consolidation (level 3), price sweeps the week high (or low), leaves an M (or W) and a rejection candle while the RSI is stretched. Trade the new direction at London or New York, stop past the sweep, aim for 3R.',
    market: 'both',
    pairs: [],
    timeframe: '1h',
    direction: 'both',
    conditions: [
      { kind: 'formation' },
      // About a week of hourly candles: "new high/low of the week".
      { kind: 'nearLevel', lookback: 120, tolerancePct: 0.5 },
      // Course: RSI near 70-80 / 20-30. Loosened to 60/40 because we check
      // the confirmation candle, after the RSI has already started to turn.
      { kind: 'rsi', period: 13, longBelow: 40, shortAbove: 60 },
      {
        kind: 'pattern',
        names: [
          ...REVERSAL_CANDLES.bullish,
          ...REVERSAL_CANDLES.bearish,
          'Tweezer Bottom',
          'Tweezer Top',
          'Piercing Line',
          'Dark Cloud Cover',
        ],
        lookback: 2,
      },
    ],
    stop: { kind: 'swing', lookback: 12, bufferPct: 0.15 },
    rr: 3,
    riskPct: 1,
    sessions: [
      { label: 'London', start: 2.5, end: 5 },
      { label: 'New York', start: 8.5, end: 11.5 },
    ],
    sources: [
      { label: MARCAR, at: '01:13 (level 3 = long consolidation, many tests)' },
      { label: MARCAR, at: '02:02 (level 3 pays best)' },
      { label: PEAKS, at: '07:12 (new low of the week, quick return inside)' },
      { label: PEAKS, at: '22:40 (peak formation at a new week high)' },
      { label: PEAKS, at: '01:49 (confirmations: twin candles, yesterday high, hammer)' },
      { label: NOTICIAS, at: '29:31 (only trade level 3 with RSI near 70-80 / 20-30)' },
      { label: NIVELES, at: '02:55 (levels are read on the 1h chart)' },
      { label: MARCAR, at: '22:24 (New York tradable until about 11:00-11:30)' },
      { label: WEBINAR, at: '16:35 (risk about 10 pips to make 50-80; 3R stands in)' },
    ],
    builtIn: true,
  },
  {
    id: 'mfx-ema-12-36-pullback',
    name: 'MFX EMA 12/36 pullback',
    summary:
      'Swing idea from the EMA video: with EMA 12 above 36 and price above the 200 (or all below for a sell), buy when price dips to the 36 and closes back on the trend side. A close through the 36 is the exit signal, so the stop sits just past recent swing.',
    market: 'both',
    pairs: [],
    timeframe: '4h',
    direction: 'both',
    conditions: [
      { kind: 'emaStack', fast: 12, slow: 36 },
      { kind: 'trend', period: 200 },
      { kind: 'emaTouch', period: 36, tolerancePct: 0.3 },
    ],
    stop: { kind: 'swing', lookback: 6, bufferPct: 0.2 },
    rr: 2,
    riskPct: 1,
    sessions: [],
    sources: [
      { label: EMA, at: '02:08 (EMAs 12, 36, 200 and 633)' },
      { label: EMA, at: '04:00 (after breaking the 12, price tests the 36)' },
      { label: EMA, at: '11:02 (price may reach the 36; past it = exit)' },
      { label: EMA, at: '11:25 (closes below 12, 36 and 200 confirm)' },
      { label: EMA, at: '12:00 (works at trend changes, not in ranges)' },
      { label: EMA, at: '21:58 (stop moved along the 36)' },
      { label: EMA, at: '10:05 (trend lines and entries read on 4h)' },
    ],
    builtIn: true,
  },
]
