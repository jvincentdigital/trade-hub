import type { Rule } from './schema'

// Rules from the Market Maker / Marvel FX Method course, in our own words,
// each with the PDF page or video + timestamp it came from. First written
// 2026-11-10 from the module 1 PDF; video sources added the same day from
// all 21 transcribed videos (see docs/strategy-rules.md). Only condition
// kinds from schema.ts are used; what the course needs beyond them is listed
// under "Conditions to add" in docs/strategies/marvel-fx-method.md.

const PDF = 'Market-Maker-Method-SquirrelFX.pdf (module 1)'
const NIVELES = 'Niveles MFXM (video)'
const PEAKS = 'PEAK FORMATIONS 1 (video)'
const MARCAR = 'Marcar Entradas Y Niveles (video)'
const NOTICIAS = 'Mejores Entradas despues de noticias (video)'
const EMA = 'Exponential Moving Average (video)'
const WEBINAR = 'sin titulo, daily webinar (video)'
const T1 = 'Teoria Parte 1 (video)'
const T2 = 'Teoria Parte 2 (video)'
const T3 = 'Teoria Parte 3 (video)'
const T4 = 'Teoria Parte 4 (video)'
const T5 = 'Teoria Parte 5 (video)'
const P1 = 'Parte practica 1 (video)'
const P2 = 'Practica 2 (video)'
const P4 = 'Practica 4 (video)'
const P5 = 'Practica 5 (video)'
const P6 = 'Practica 6 (video)'
const P8 = 'Practica 8 (video)'

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
      { label: T2, at: '19:53 (only four setups: stop hunt high / low, fall, rise)' },
      { label: T4, at: '00:26 (range, then stop hunt, then the real move)' },
      { label: T1, at: '10:18 (the 3:30 and 9:30 candles are the key ones)' },
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
      { label: T1, at: '25:02 (rarely more than three days one way)' },
      { label: T2, at: '00:52 (a level = a rise or fall of about three days)' },
      { label: T4, at: '01:41 (weekly cycle: up, then 2-3 days down)' },
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
      { label: T2, at: '01:19 (level 3 is the stop-hunting, most profitable one)' },
      { label: T4, at: '08:28 (EMAs wide apart point to level 3)' },
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
  {
    id: 'mfx-second-leg-day-extreme',
    name: 'MFX second leg at the day high/low',
    summary:
      'The core intraday setup of the theory and practice videos: price runs to the high (or low) of the day, pulls back, and the second leg fails near that extreme with a rejection candle. Enter on the closed candle once EMA 5 is on the trade side of EMA 13, in the London or New York window only. Tight stop past the extreme, about 3R (10 pips risked for 30-50).',
    market: 'both',
    pairs: [],
    timeframe: '1h',
    direction: 'both',
    conditions: [
      // About one day of hourly candles: "near the high or low of the day".
      { kind: 'nearLevel', lookback: 24, tolerancePct: 0.4 },
      {
        kind: 'pattern',
        names: [
          ...REVERSAL_CANDLES.bullish,
          ...REVERSAL_CANDLES.bearish,
          'Morning Star',
          'Evening Star',
          'Tweezer Bottom',
          'Tweezer Top',
        ],
        lookback: 2,
      },
      // Stands in for the fresh 5/13 cross (we have no cross condition).
      { kind: 'emaStack', fast: 5, slow: 13 },
    ],
    // 7 pips + spread is roughly 0.1% on the major pairs.
    stop: { kind: 'swing', lookback: 6, bufferPct: 0.1 },
    rr: 3,
    // The course says 2% (Parte practica 1 @ 18:45); we keep 1% for play money.
    riskPct: 1,
    sessions: [
      { label: 'London', start: 3, end: 6 },
      { label: 'New York', start: 9, end: 11.5 },
    ],
    sources: [
      { label: T3, at: '16:57 (best entry: second leg of the M or W)' },
      { label: T5, at: '12:02 (no second leg, no trade)' },
      { label: P1, at: '21:13 (valid while the day low holds)' },
      { label: T3, at: '00:22 (key candles form near the day high/low)' },
      { label: T5, at: '01:42 (buy only after a green close)' },
      { label: P1, at: '23:32 (never enter on a forming candle)' },
      { label: T4, at: '05:01 (EMA 5 and 13 confirm the entry)' },
      { label: P2, at: '04:47 (entry when the 5 and 13 cross)' },
      { label: P4, at: '28:54 (5/13 cross only in a trend, not a range)' },
      { label: T3, at: '26:09 (second leg around 3-4 AM New York time)' },
      { label: T4, at: '33:13 (New York reversal between 9 and 11)' },
      { label: T2, at: '13:55 (stop 7 pips + spread past the day extreme)' },
      { label: P1, at: '06:47 (7 pips + spread past the high/low of day)' },
      { label: T2, at: '27:17 (aim for 30-50 pips)' },
      { label: P1, at: '18:40 (14 pips risked for 50, over 3:1)' },
    ],
    builtIn: true,
  },
  {
    id: 'mfx-ema800-pin',
    name: 'MFX EMA 800 pin (1h EMA 200)',
    summary:
      'Price pokes through the slow EMA with a pin and closes back on the other side: a buy off it from above, a sell off it from below. The course reads the 800 EMA on 15-minute candles, which sits about where the 200 EMA is on 1h, so we use the 1h 200. New York morning only, target about 2R (the course aims for the next EMA).',
    market: 'both',
    pairs: [],
    timeframe: '1h',
    direction: 'both',
    conditions: [
      { kind: 'emaTouch', period: 200, tolerancePct: 0.1 },
      {
        kind: 'pattern',
        names: [...REVERSAL_CANDLES.bullish, ...REVERSAL_CANDLES.bearish],
        lookback: 1,
      },
    ],
    stop: { kind: 'swing', lookback: 4, bufferPct: 0.1 },
    rr: 2,
    riskPct: 1,
    sessions: [{ label: 'New York', start: 9, end: 12 }],
    sources: [
      { label: P8, at: '02:42 (pins barely breaking the EMA 800)' },
      { label: P8, at: '02:56 (closing as a doji = the entry)' },
      { label: P6, at: '06:44 (wicks at the 800 before the drop)' },
      { label: P5, at: '02:29 (15m EMA 800 matches 1h EMA 200)' },
      { label: T4, at: '09:51 (same mapping shown on the chart)' },
      { label: P8, at: '03:49 (target near the EMA 200)' },
      { label: P8, at: '06:38 (stop 7 pips + 1 spread)' },
      { label: P8, at: '07:21 (no open trades in the afternoon)' },
    ],
    builtIn: true,
  },
]
