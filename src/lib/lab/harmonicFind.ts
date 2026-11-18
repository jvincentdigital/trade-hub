// Harmonic study (docs/harmonic-study.md, with Amendments 1 to 3): chart
// candles, true range and ATR, swings, the four points, the patterns table,
// the confirming-candle rule and the wait. Pure. All times are UTC seconds;
// all prices are the Bid. Bars are held as one typed array per column.

/** 1-minute Bid candles, oldest first, one typed array per column. */
export interface Bars {
  n: number
  time: Float64Array
  open: Float64Array
  high: Float64Array
  low: Float64Array
  close: Float64Array
}

export type HarmonicMarket =
  | 'EURUSD'
  | 'GBPUSD'
  | 'XAUUSD'
  | 'USDJPY'
  | 'EURGBP'
  | 'EURJPY'
  | 'GBPJPY'
  | 'AUDJPY'
  | 'CADJPY'
  | 'NZDJPY'
  | 'CHFJPY'

/** The study's seven markets. Amendment 5's four yen pairs are not in this list. */
export const HARMONIC_MARKETS: HarmonicMarket[] = [
  'EURUSD',
  'GBPUSD',
  'XAUUSD',
  'USDJPY',
  'EURGBP',
  'EURJPY',
  'GBPJPY',
]

/** Prices and costs ("Prices and costs", Amendment 2 point 1, Amendment 3 point 4). */
export interface MarketCosts {
  market: HarmonicMarket
  /** One pip in price. */
  pip: number
  /** 0.5 pip (gold $0.05): how far the Ask must go through D. */
  pen: number
  /** 0.2 pip: lost on every market entry, stop fill and market close. */
  slip: number
  /** Gold's $0.07 an ounce, 0 for the pairs. Part of the round-trip cost. */
  comm: number
  /** Spread for a trade priced at `price` (fixed for the life of the trade). */
  spreadAt: (price: number) => number
}

const pair = (market: HarmonicMarket, pip: number, spread: number): MarketCosts => ({
  market,
  pip,
  pen: pip === 0.01 ? 0.005 : 0.00005,
  slip: pip === 0.01 ? 0.002 : 0.00002,
  comm: 0,
  spreadAt: () => spread,
})

export const MARKET_COSTS: Record<HarmonicMarket, MarketCosts> = {
  EURUSD: pair('EURUSD', 0.0001, 0.00008),
  GBPUSD: pair('GBPUSD', 0.0001, 0.0001),
  EURGBP: pair('EURGBP', 0.0001, 0.0001),
  USDJPY: pair('USDJPY', 0.01, 0.009),
  EURJPY: pair('EURJPY', 0.01, 0.013),
  GBPJPY: pair('GBPJPY', 0.01, 0.02),
  // Amendment 5: assumed typical spreads, set before any price was read.
  AUDJPY: pair('AUDJPY', 0.01, 0.016),
  CADJPY: pair('CADJPY', 0.01, 0.025),
  NZDJPY: pair('NZDJPY', 0.01, 0.025),
  CHFJPY: pair('CHFJPY', 0.01, 0.025),
  XAUUSD: {
    market: 'XAUUSD',
    pip: 0.1,
    pen: 0.05,
    slip: 0.02,
    comm: 0.07,
    spreadAt: (price) => (0.28 * price) / 1800,
  },
}

// ---------------------------------------------------------------- charts

/** 15 or 30 minute chart candles on UTC clock boundaries; each knows its 1-minute bars. */
export interface Chart {
  minutes: number
  sec: number
  n: number
  /** Open time of each chart candle (its close is time + sec). */
  time: Float64Array
  open: Float64Array
  high: Float64Array
  low: Float64Array
  close: Float64Array
  /** Index of the candle's first 1-minute bar. */
  first: Int32Array
  /** One past the index of the candle's last 1-minute bar. */
  end: Int32Array
  /** Chart candle of each 1-minute bar. */
  ofMinute: Int32Array
}

/** A chart candle exists if it has at least one 1-minute bar. */
export function buildChart(bars: Bars, minutes: number): Chart {
  const sec = minutes * 60
  const ofMinute = new Int32Array(bars.n)
  let n = 0
  let key = NaN
  for (let i = 0; i < bars.n; i++) {
    const k = Math.floor(bars.time[i] / sec)
    if (k !== key) {
      key = k
      n++
    }
    ofMinute[i] = n - 1
  }
  const c: Chart = {
    minutes,
    sec,
    n,
    time: new Float64Array(n),
    open: new Float64Array(n),
    high: new Float64Array(n),
    low: new Float64Array(n),
    close: new Float64Array(n),
    first: new Int32Array(n),
    end: new Int32Array(n),
    ofMinute,
  }
  let j = -1
  for (let i = 0; i < bars.n; i++) {
    if (ofMinute[i] !== j) {
      j = ofMinute[i]
      c.time[j] = Math.floor(bars.time[i] / sec) * sec
      c.open[j] = bars.open[i]
      c.high[j] = bars.high[i]
      c.low[j] = bars.low[i]
      c.first[j] = i
    } else {
      if (bars.high[i] > c.high[j]) c.high[j] = bars.high[i]
      if (bars.low[i] < c.low[j]) c.low[j] = bars.low[i]
    }
    c.close[j] = bars.close[i]
    c.end[j] = i + 1
  }
  return c
}

// ---------------------------------------------------------------- swings

/** True range; the first candle has no previous close, so its range is high - low (Amendment 3 point 1). */
export function trueRanges(high: Float64Array, low: Float64Array, close: Float64Array) {
  const n = high.length
  const tr = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    if (i === 0) tr[i] = high[i] - low[i]
    else {
      const pc = close[i - 1]
      tr[i] = Math.max(high[i], pc) - Math.min(low[i], pc)
    }
  }
  return tr
}

/** ATR at candle i = mean of the true ranges of candles i-13 to i; NaN before the 14th candle. */
export function atr14(tr: Float64Array): Float64Array {
  const n = tr.length
  const a = new Float64Array(n).fill(NaN)
  for (let i = 13; i < n; i++) {
    let s = 0
    for (let j = i - 13; j <= i; j++) s += tr[j]
    a[i] = s / 14
  }
  return a
}

/** A confirmed swing. */
export interface Swing {
  /** 1 a high, -1 a low. */
  kind: 1 | -1
  /** Chart candle that holds the extreme. */
  idx: number
  price: number
  /** Chart candle at whose close the swing is confirmed. */
  confirm: number
  /** The next swing's first candidate (lowest low, or highest high, after idx through confirm). */
  next: number
  /** Chart candle of that candidate. */
  nextIdx: number
}

/** Swings of size k (2 or 3), from the first candle, starting with a high forming. */
export function findSwings(
  high: Float64Array,
  low: Float64Array,
  close: Float64Array,
  k: number,
): Swing[] {
  const n = high.length
  const atr = atr14(trueRanges(high, low, close))
  const out: Swing[] = []
  if (n === 0) return out
  let kind: 1 | -1 = 1
  let cand = 0
  let candP = high[0]
  for (let i = 1; i < n; i++) {
    const a = atr[i]
    if (kind === 1) {
      if (high[i] > candP) {
        cand = i
        candP = high[i]
        continue
      }
      if (a === a && low[i] <= candP - k * a) {
        let j = cand + 1
        let p = low[j]
        for (let q = cand + 2; q <= i; q++)
          if (low[q] < p) {
            j = q
            p = low[q]
          }
        out.push({ kind: 1, idx: cand, price: candP, confirm: i, next: p, nextIdx: j })
        kind = -1
        cand = j
        candP = p
      }
    } else {
      if (low[i] < candP) {
        cand = i
        candP = low[i]
        continue
      }
      if (a === a && high[i] >= candP + k * a) {
        let j = cand + 1
        let p = high[j]
        for (let q = cand + 2; q <= i; q++)
          if (high[q] > p) {
            j = q
            p = high[q]
          }
        out.push({ kind: -1, idx: cand, price: candP, confirm: i, next: p, nextIdx: j })
        kind = 1
        cand = j
        candP = p
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- patterns

export type PatternName = 'gartley' | 'bat' | 'butterfly' | 'crab'

export interface PatternRule {
  name: PatternName
  rB: [number, number]
  d: number
  s: number
  proj: [number, number]
}

export const PATTERN_RULES: PatternRule[] = [
  { name: 'gartley', rB: [0.568, 0.668], d: 0.786, s: 1.05, proj: [1.27, 1.618] },
  { name: 'bat', rB: [0.382, 0.5], d: 0.886, s: 1.13, proj: [1.618, 2.618] },
  { name: 'butterfly', rB: [0.736, 0.836], d: 1.27, s: 1.414, proj: [1.618, 2.618] },
  { name: 'crab', rB: [0.382, 0.618], d: 1.618, s: 2.0, proj: [2.24, 3.618] },
]

export const RC_RANGE: [number, number] = [0.382, 0.886]
export const RATIO_TOL = 1e-9

/** Inclusive ratio test with a tolerance of 1e-9. */
export const inRange = (r: number, [lo, hi]: [number, number]) =>
  r >= lo - RATIO_TOL && r <= hi + RATIO_TOL

export interface PatternLevels {
  name: PatternName
  rB: number
  rC: number
  proj: number
  d: number
  stop: number
}

/**
 * The patterns that qualify for X, A, B, C ("The four points"). dir 1 is a
 * buy (X low, A high, B low, C high), -1 a sell (X high, A low, B high, C low).
 */
export function matchPatterns(
  dir: 1 | -1,
  x: number,
  a: number,
  b: number,
  c: number,
): PatternLevels[] {
  const out: PatternLevels[] = []
  const xa = dir === 1 ? a - x : x - a
  const rB = dir === 1 ? (a - b) / xa : (b - a) / xa
  const rC = dir === 1 ? (c - b) / (a - b) : (b - c) / (b - a)
  if (!inRange(rC, RC_RANGE)) return out
  for (const p of PATTERN_RULES) {
    if (!inRange(rB, p.rB)) continue
    const d = dir === 1 ? a - p.d * xa : a + p.d * xa
    const stop = dir === 1 ? a - p.s * xa : a + p.s * xa
    const proj = dir === 1 ? (c - d) / (c - b) : (d - c) / (b - c)
    if (!inRange(proj, p.proj)) continue
    out.push({ name: p.name, rB, rC, proj, d, stop })
  }
  return out
}

// ---------------------------------------------------------------- the wait

export type WaitOutcome =
  | 'skipped'
  | 'completed'
  | 'cancelled_c'
  | 'cancelled_time'
  | 'cancelled_swing'
  | 'waiting'

export interface WaitResult {
  outcome: WaitOutcome
  /** 1-minute bar for completed and cancelled_c, else -1. */
  minute: number
  /** Chart candle for cancelled_time and cancelled_swing, else -1. */
  candle: number
  /** completed, cancelled_c: the minute's stamp; cancelled_time, cancelled_swing: the candle's close; else NaN. */
  time: number
}

export const WAIT_CANDLES = 192

/**
 * The wait ("The wait"), on 1-minute Bid candles from the first minute after
 * the confirming candle's close. Buys complete at Bid low <= D - spread - pen,
 * sells at Bid high >= D + pen; a minute beyond C cancels (and wins over a
 * completion in the same minute); the close of the 192nd chart candle after
 * the confirming candle, or of the candle that confirms the next swing,
 * cancels too (the swing wins when they are the same candle).
 */
export function runWait(
  bars: Bars,
  chart: Chart,
  costs: MarketCosts,
  dir: 1 | -1,
  c: number,
  d: number,
  confirm: number,
  nextConfirm: number,
): WaitResult {
  const spread = costs.spreadAt(d)
  const buyAt = d - spread - costs.pen
  const sellAt = d + costs.pen
  const timeCandle = confirm + WAIT_CANDLES
  let cancel = -1
  let why: WaitOutcome = 'waiting'
  if (nextConfirm >= 0 && nextConfirm <= timeCandle) {
    cancel = nextConfirm
    why = 'cancelled_swing'
  } else if (timeCandle < chart.n) {
    cancel = timeCandle
    why = 'cancelled_time'
  }
  const from = confirm + 1 < chart.n ? chart.first[confirm + 1] : bars.n
  const to = cancel >= 0 ? chart.end[cancel] : bars.n
  const { high, low, time } = bars
  for (let m = from; m < to; m++) {
    if (dir === 1) {
      if (high[m] > c) return { outcome: 'cancelled_c', minute: m, candle: -1, time: time[m] }
      if (low[m] <= buyAt) return { outcome: 'completed', minute: m, candle: -1, time: time[m] }
    } else {
      if (low[m] < c) return { outcome: 'cancelled_c', minute: m, candle: -1, time: time[m] }
      if (high[m] >= sellAt) return { outcome: 'completed', minute: m, candle: -1, time: time[m] }
    }
  }
  if (cancel < 0) return { outcome: 'waiting', minute: -1, candle: -1, time: NaN }
  return { outcome: why, minute: -1, candle: cancel, time: chart.time[cancel] + chart.sec }
}

/** A swing point of a pattern. */
export interface Point {
  /** Chart candle that holds the extreme. */
  idx: number
  /** Open time of that candle. */
  time: number
  price: number
}

export interface Pattern {
  /** Position in the run's pattern list. */
  id: number
  market: HarmonicMarket
  chart: number
  k: number
  name: PatternName
  dir: 1 | -1
  x: Point
  a: Point
  b: Point
  c: Point
  /** Index of C in the swing list. */
  swing: number
  /** Chart candle that confirmed C. */
  confirm: number
  /** Open time of the confirming candle. */
  confirmTime: number
  /** Close time of the confirming candle (a pattern's year is this one's). */
  confirmClose: number
  /** Chart candle that confirms the next swing after C, or -1. */
  nextConfirm: number
  rB: number
  rC: number
  proj: number
  d: number
  stop: number
  /** How many patterns this C gave (1 or 2). */
  ofC: number
  wait: WaitResult
}

/** Every pattern of one chart and swing size, in order of C, with its wait. */
export function findPatterns(
  bars: Bars,
  chart: Chart,
  costs: MarketCosts,
  k: number,
  swings: Swing[] = findSwings(chart.high, chart.low, chart.close, k),
): Pattern[] {
  const out: Pattern[] = []
  const point = (s: Swing): Point => ({ idx: s.idx, time: chart.time[s.idx], price: s.price })
  for (let i = 3; i < swings.length; i++) {
    const [sx, sa, sb, sc] = [swings[i - 3], swings[i - 2], swings[i - 1], swings[i]]
    const dir = sc.kind
    const found = matchPatterns(dir, sx.price, sa.price, sb.price, sc.price)
    const nextConfirm = i + 1 < swings.length ? swings[i + 1].confirm : -1
    for (const lv of found) {
      const skip = dir === 1 ? sc.next <= lv.d : sc.next >= lv.d
      const wait: WaitResult = skip
        ? { outcome: 'skipped', minute: -1, candle: -1, time: NaN }
        : runWait(bars, chart, costs, dir, sc.price, lv.d, sc.confirm, nextConfirm)
      out.push({
        id: out.length,
        market: costs.market,
        chart: chart.minutes,
        k,
        name: lv.name,
        dir,
        x: point(sx),
        a: point(sa),
        b: point(sb),
        c: point(sc),
        swing: i,
        confirm: sc.confirm,
        confirmTime: chart.time[sc.confirm],
        confirmClose: chart.time[sc.confirm] + chart.sec,
        nextConfirm,
        rB: lv.rB,
        rC: lv.rC,
        proj: lv.proj,
        d: lv.d,
        stop: lv.stop,
        ofC: found.length,
        wait,
      })
    }
  }
  return out
}
