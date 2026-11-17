/**
 * Our own copy of the Golden Owl's trading rules (docs/owl-copy-study.md).
 *
 * The Owl is a renamed build of xBest, a free robot with public code
 * (docs/owl-decoded.md). These rules were written from the plain-word rule
 * descriptions in that decode; no code was copied. Lab only, play money.
 */

import type { OHLCCandle } from '../types/market'

/** One lot of gold is 100 ounces. */
export const OZ_PER_LOT = 100
/** The walk inside a candle moves at most this many dollars at a time. */
export const GRAIN = 0.1
/** Trades already open count this many dollars worse in the target's average. */
export const HAIRCUT = 0.02
/** The hidden rule: with more than this many trades seen on a side and a dollar of open profit, close everything. */
export const KILL_COUNT = 12
export const KILL_PROFIT = 1
/** "After Level Change Lot A to B": above this stored count the other side's first trade is resized. */
export const HEDGE_LEVEL = 2
const EPS = 1e-9

/** Rounds half up to two decimals (0.01 lot, one cent). */
export const round2 = (x: number) => Math.floor(x * 100 + 0.5 + EPS) / 100

export interface CopyConfig {
  /** First trade, in lots. */
  firstLot: number
  /** Largest single trade, in lots. */
  maxLot: number
  /** Each added trade is the first size times this, once per trade already open. */
  factor: number
  /** Distance between added trades, in dollars. */
  grid: number
  /** Distance from the weighted average entry to the target, in dollars. */
  take: number
  /** A side with an open loss above this percent of equity is in pause. */
  pausePct: number
  /** An open loss above this percent of equity closes everything. */
  stopPct: number
  /** Most trades per side; 0 = no limit. */
  maxTrades: number
  /** Ask minus Bid, in dollars. */
  spread: number
  /** Dollars per ounce, charged when a trade closes. */
  commission: number
  /** The resized first trade of the fresh side: rounded and opened (main reading) or refused (sensitivity). */
  hedgeFirst: 'rounded' | 'refused'
  /** After a stop: the session ends (main reading) or trading starts over (sensitivity). */
  afterStop: 'end' | 'resume'
}

/** The passive 50k preset file. */
export const AS_SOLD = {
  firstLot: 0.02,
  maxLot: 0.5,
  factor: 1.357,
  grid: 1,
  take: 1,
  pausePct: 2,
  stopPct: 4,
  maxTrades: 0,
  hedgeFirst: 'rounded',
  afterStop: 'end',
} as const satisfies Omit<CopyConfig, 'spread' | 'commission'>

export interface Averages {
  high: Float64Array
  low: Float64Array
  open: Float64Array
}

/** The three running averages over the whole candle series: 3 candles on highs and lows, 34 on opens. */
export function averages(m1: OHLCCandle[]): Averages {
  const n = m1.length
  const high = new Float64Array(n)
  const low = new Float64Array(n)
  const open = new Float64Array(n)
  const k = 2 / 35
  for (let i = 0; i < n; i++) {
    const b = m1[i]
    if (i === 0) {
      high[0] = b.high
      low[0] = b.low
      open[0] = b.open
      continue
    }
    high[i] = 0.5 * b.high + 0.5 * high[i - 1]
    low[i] = 0.5 * b.low + 0.5 * low[i - 1]
    open[i] = k * b.open + (1 - k) * open[i - 1]
  }
  return { high, low, open }
}

/** The moments of a session: the price (Bid) at each, whether it is a candle open (a jump), and the signal as sold and inverted. */
export interface Moments {
  n: number
  p: Float64Array
  jump: Uint8Array
  sig: Int8Array
  sigInv: Int8Array
}

/**
 * Walks candles `from` (inclusive) to `to` (exclusive) of the series. Every
 * candle's open is a moment, reached by a jump; then open, low, high, close
 * (closed up or flat) or open, high, low, close (closed down) in moves of at
 * most GRAIN. `reversed` swaps the two orders (a sensitivity run).
 */
export function momentsOf(
  m1: OHLCCandle[],
  avg: Averages,
  from: number,
  to: number,
  reversed = false,
): Moments {
  const p: number[] = []
  const jump: number[] = []
  const sig: number[] = []
  const sigInv: number[] = []
  for (let i = from; i < to; i++) {
    const b = m1[i]
    const prev = i > 0 ? i - 1 : 0
    const eh = avg.high[prev]
    const el = avg.low[prev]
    const ma = avg.open[i]
    let hi = b.open
    let lo = b.open
    const at = (x: number, isJump: number) => {
      if (x > hi) hi = x
      if (x < lo) lo = x
      const top = 0.5 * hi + 0.5 * eh
      const bottom = 0.5 * lo + 0.5 * el
      const short = x > top ? 1 : x < bottom ? -1 : 0
      const long = x > ma ? 1 : x < ma ? -1 : 0
      p.push(x)
      jump.push(isJump)
      sig.push(short !== 0 && short === long ? short : 0)
      sigInv.push(short !== 0 && -short === long ? long : 0)
    }
    at(b.open, 1)
    const lowFirst = b.close >= b.open !== reversed
    const path = lowFirst ? [b.low, b.high, b.close] : [b.high, b.low, b.close]
    let a = b.open
    for (const end of path) {
      if (end === a) continue
      const n = Math.max(1, Math.ceil(Math.abs(end - a) / GRAIN - EPS))
      for (let k = 1; k <= n; k++) at(a + ((end - a) * k) / n, 0)
      a = end
    }
  }
  return {
    n: p.length,
    p: Float64Array.from(p),
    jump: Uint8Array.from(jump),
    sig: Int8Array.from(sig),
    sigInv: Int8Array.from(sigInv),
  }
}

/** The size in lots of the trade opened when `n` trades are already open on the side. */
export function lots(cfg: Pick<CopyConfig, 'firstLot' | 'factor' | 'maxLot'>, n: number): number {
  return Math.min(cfg.maxLot, round2(cfg.firstLot * Math.pow(cfg.factor, n)))
}

export interface SessionResult {
  /** The session's result in dollars, after spread and commission. */
  pnl: number
  /** The stop closed everything at least once. */
  stopped: boolean
  /** Sequences that closed at their target. */
  targets: number
  /** Trades opened. */
  trades: number
  /** Times the hidden rule closed everything. */
  kills: number
  /** The lowest point of the session, open trades included, in dollars. */
  worst: number
  /** The most trades open on one side at once. */
  deepest: number
}

/**
 * One session of the copy on an account of `balance` dollars. `inverted`
 * uses the signal with its short-average part inverted; `shift` moves the
 * signal in time by that many moments (the "twins" of part C).
 */
export function runSession(
  m: Moments,
  cfg: CopyConfig,
  balance: number,
  inverted = false,
  shift = 0,
): SessionResult {
  const sig = inverted ? m.sigInv : m.sig
  const { grid, take, spread, commission, factor, maxLot, maxTrades } = cfg
  const pause = cfg.pausePct / 100
  const stop = cfg.stopPct / 100
  const size: number[] = []
  for (let n = 0; n < 64; n++) size.push(lots(cfg, n))
  const sizeOf = (n: number) => size[Math.min(n, 63)]
  const resized = (lot: number) =>
    cfg.hedgeFirst === 'rounded' ? Math.min(maxLot, Math.max(0.01, round2(lot / factor))) : 0

  // Buy side (B) and sell side (S): open trades, ounces, sum of entry times ounces, last entry, last size, target.
  let nB = 0
  let ozB = 0
  let sumB = 0
  let lastB = 0
  let lotB = 0
  let tpB = 0
  let storedB = 0
  let fA = false
  let nS = 0
  let ozS = 0
  let sumS = 0
  let lastS = 0
  let lotS = 0
  let tpS = 0
  let storedS = 0
  let fB = false

  let realized = 0
  let targets = 0
  let trades = 0
  let kills = 0
  let worst = 0
  let deepest = 0
  let stopped = false
  let bid = 0
  let ask = 0

  for (let k = 0; k < m.n; k++) {
    bid = m.p[k]
    ask = bid + spread

    // 1. Targets, at the broker; a jump past the target fills at the jump's price.
    if (nB > 0 && bid >= tpB) {
      realized += ozB * (m.jump[k] ? bid : tpB) - sumB - commission * ozB
      targets++
      nB = 0
      ozB = 0
      sumB = 0
    }
    if (nS > 0 && ask <= tpS) {
      realized += sumS - ozS * (m.jump[k] ? ask : tpS) - commission * ozS
      targets++
      nS = 0
      ozS = 0
      sumS = 0
    }
    const liveB = nB > 0 ? lotB : 0
    const liveS = nS > 0 ? lotS : 0

    // 2. Stop.
    let open = ozB * bid - sumB + (sumS - ozS * ask)
    if (open < 0 && -open > stop * (balance + realized + open)) {
      realized += open - commission * (ozB + ozS)
      nB = nS = 0
      ozB = ozS = 0
      sumB = sumS = 0
      open = 0
      stopped = true
      if (realized < worst) worst = realized
      if (cfg.afterStop === 'end') break
      // Start over: the rest of this moment is skipped, trading goes on at the next one.
      continue
    }

    // 3. The hidden rule.
    if (open >= KILL_PROFIT && (storedB > KILL_COUNT || storedS > KILL_COUNT)) {
      realized += open - commission * (ozB + ozS)
      kills++
      nB = nS = 0
      ozB = ozS = 0
      sumB = sumS = 0
      open = 0
    }

    // 4. The engine whose signal is on.
    const s = shift ? sig[(k + shift) % m.n] : sig[k]
    if (s === 1) {
      const n = nB
      storedB = n
      let lot = 0
      if (n > 0) {
        if (!fA && lastB - ask >= grid - EPS && (maxTrades === 0 || n < maxTrades)) lot = sizeOf(n)
      } else if (!(fA && !fB)) {
        lot = storedS > HEDGE_LEVEL && liveS > 0 ? resized(liveS) : sizeOf(0)
      }
      const mine = ozB * bid - sumB
      fA = mine < 0 && -mine > pause * (balance + realized + open)
      if (lot > 0) {
        const oz = lot * OZ_PER_LOT
        tpB = round2((sumB - HAIRCUT * ozB + ask * oz) / (ozB + oz)) + take
        nB++
        ozB += oz
        sumB += ask * oz
        lastB = ask
        lotB = lot
        trades++
        if (nB > deepest) deepest = nB
        open = ozB * bid - sumB + (sumS - ozS * ask)
      }
    } else if (s === -1) {
      const n = nS
      storedS = n
      let lot = 0
      if (n > 0) {
        if (!fA && !fB && bid - lastS >= grid - EPS && (maxTrades === 0 || n < maxTrades))
          lot = sizeOf(n)
      } else if (fA === fB) {
        lot = storedB > HEDGE_LEVEL && liveB > 0 ? resized(liveB) : sizeOf(0)
      }
      const mine = sumS - ozS * ask
      fB = mine < 0 && -mine > pause * (balance + realized + open)
      if (lot > 0) {
        const oz = lot * OZ_PER_LOT
        tpS = round2((sumS + HAIRCUT * ozS + bid * oz) / (ozS + oz)) - take
        nS++
        ozS += oz
        sumS += bid * oz
        lastS = bid
        lotS = lot
        trades++
        if (nS > deepest) deepest = nS
        open = ozB * bid - sumB + (sumS - ozS * ask)
      }
    }

    const now = realized + open
    if (now < worst) worst = now
  }

  // 5. End of the session: what is still open closes at market.
  if (nB > 0 || nS > 0) {
    realized += ozB * bid - sumB + (sumS - ozS * ask) - commission * (ozB + ozS)
    if (realized < worst) worst = realized
  }
  return { pnl: realized, stopped, targets, trades, kills, worst, deepest }
}

export const HORIZONS = [5, 15, 60] as const

/** A count and a sum of moves, in dollars per ounce. */
export interface Tally {
  n: number
  sum: number
}

/** Part B, one evening: per horizon, the moves after fresh buy signals, after fresh sell signals (in the sell's direction), and from every candle (the base rate, as plain price change). */
export interface EveningMoves {
  buy: Tally[]
  sell: Tally[]
  base: Tally[]
}

/** The signal at a candle's close: +1, -1 or 0. */
export function signalAtClose(m1: OHLCCandle[], avg: Averages, i: number): number {
  const b = m1[i]
  const prev = i > 0 ? i - 1 : 0
  const short =
    b.close > 0.5 * b.high + 0.5 * avg.high[prev]
      ? 1
      : b.close < 0.5 * b.low + 0.5 * avg.low[prev]
        ? -1
        : 0
  const long = b.close > avg.open[i] ? 1 : b.close < avg.open[i] ? -1 : 0
  return short === long ? short : 0
}

/** Part B for the session of candles `from` to `to` that ends at time `end`. */
export function eveningMoves(
  m1: OHLCCandle[],
  avg: Averages,
  from: number,
  to: number,
  end: number,
): EveningMoves {
  const tally = (): Tally[] => HORIZONS.map(() => ({ n: 0, sum: 0 }))
  const out: EveningMoves = { buy: tally(), sell: tally(), base: tally() }
  for (let i = from; i < to; i++) {
    const s = signalAtClose(m1, avg, i)
    const fresh = s !== 0 && !(i > 0 && signalAtClose(m1, avg, i - 1) === s)
    HORIZONS.forEach((h, x) => {
      const t = m1[i].time + h * 60
      if (t >= end) return
      let j = i
      while (j + 1 < m1.length && m1[j + 1].time <= t) j++
      const change = m1[j].close - m1[i].close
      out.base[x].n++
      out.base[x].sum += change
      if (!fresh) return
      const side = s === 1 ? out.buy : out.sell
      side[x].n++
      side[x].sum += change * s
    })
  }
  return out
}
