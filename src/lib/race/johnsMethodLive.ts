import type { OHLCCandle } from '../types/market'
import {
  atrAt,
  entryFill,
  findSignals,
  hourMult,
  JM,
  JM_MARKET,
  noChase,
  plan,
  prepareJm,
  roundTrip,
  targetsOk,
  type JmMarketId,
  type JmSignal,
} from '../lab/johnsMethod'
import { nyCloseBars } from '../lab/load'
import type { NewsEvent } from '../lab/news'
import { DAY, HOUR } from '../lab/time'
import { DOLLAR, newTradeBlock, sizeRaceTrade, type Exposure } from './account'
import { closedOnly } from './candles'
import {
  tradeExits,
  tradeRisk,
  type ClosedLiveTrade,
  type JmPart,
  type LiveTrade,
  type RaceStrategy,
  type StepResult,
} from './live'

// John's Method (from his video) as ONE quiet Lab account in the live race.
// Spec: ~/jvd-outputs/2026-11-12/johns-method/SPEC.md. Watch only: no
// version passed the design years (docs/johns-method-freeze.md: "the design
// years did not confirm", no exam run), so this is the plain base on John's
// own charts: the Fib on the 4-hour, entries on the 1-hour (H4-H1), expiry
// X1, the capped halves (C). It never feeds the funded test.
//
// Every check rebuilds the setups with the backtest's own code (findSignals
// in src/lib/lab/johnsMethod.ts) on CLOSED Kraken 1-hour candles, with the
// 4-hour built from them on the 17:00 New York close. This file adds the
// live parts: one look per signal, the checks of SPEC 2.6 at the price now,
// the ladder (half 2 at 0.886, the double down), the 120-candle time limit,
// and the race's account rules. Any hour: no 02:00 to 12:30 window and no
// 12:45 close (race-tick passes this account to applyDailyClose's keepOpen).
// Not live: swap (the race charges none), the daily lines (report only, and
// 250 daily candles are not in the feed). Play money only. Pure, tested.

export const JOHNS_METHOD = {
  id: 'lab-johns-method',
  name: "Lab: John's Method (watch only)",
  /** SPEC 2.2's markets the race prices live (USD/JPY and NZD/USD are ECB daily rates, NOT_LIVE). */
  markets: ['EUR-USD', 'GBP-USD', 'AUD-USD', 'USD-CHF', 'USD-CAD', 'pax-gold'],
  pair: 'H4H1',
  expiry: 'X1',
  sizing: 'C',
  why: "John's method from his video, watch only (it did not pass its design years). Fib on 4-hour candles (New York close): after a move of 2x ATR within 12 candles, 1 = the open of the first candle of the move, 0 = the end, and 0 follows the move. A finished 1-hour candle that reaches 0.786 without passing 1 is the signal. Half (1% risk) goes in at the next check, the other half (1%) after a candle reaches 0.886. Two strong candles his way add the rest up to 2% and move the stop behind the pullback. Stop half a 4-hour ATR past 1. Half off at 0, the rest at -0.272. Out after 120 hourly candles (about 5 trading days). Any hour, no 12:45 close.",
} as const

export type JohnsMethodMarket = (typeof JOHNS_METHOD.markets)[number]

const JM_ID: Record<JohnsMethodMarket, JmMarketId> = {
  'EUR-USD': 'EURUSD',
  'GBP-USD': 'GBPUSD',
  'AUD-USD': 'AUDUSD',
  'USD-CHF': 'USDCHF',
  'USD-CAD': 'USDCAD',
  'pax-gold': 'XAUUSD',
}

/** A decision is acted on up to 2 hours after its candle closes (SPEC 2.6 check 2). */
export const FILL_WAIT = JM.fillWait
/**
 * Setups are rebuilt each check from the oldest candle in the feed (Kraken
 * gives 720 hourly candles, about 30 days) plus this warm-up for the ATR and
 * the 12-candle look-back. Measured on design-year history (6 markets, 120
 * days, hourly checks): 69 of the backtest's 71 signals, 6 extra. A start 21
 * days back gave 67 and 21 extra; the backtest's own start gives all 71.
 */
export const WARMUP = 5 * DAY
/** Longest hold in 1-hour candles: 30 four-hour candles' worth (SPEC 2.9). */
export const HOLD = JM.holdFibCandles * 4

export interface JmMarketInput {
  market: JohnsMethodMarket
  /** CLOSED 1-hour candles, oldest first, market-closed hours left out. */
  h1: OHLCCandle[]
  /** Candles exits are checked on (closed 15-minute), oldest first. */
  path: OHLCCandle[]
  price: number
  usdPerQuote: number | null
  feeRate: number
  leverage: number
}

export interface JmStep extends StepResult {
  /** Plain words per market for the log. */
  notes: { market: string; note: string }[]
}

const hhmm = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ')

/** The signals of one market (the backtest's tracker, H4-H1, X1), rebuilt from the whole feed. */
export function jmSignals(market: JohnsMethodMarket, h1: OHLCCandle[], nowSec: number): JmSignal[] {
  if (!h1.length) return []
  const nyBars = (c: OHLCCandle[], sec: number) =>
    closedOnly(nyCloseBars(c, sec), sec / HOUR, nowSec)
  const d = prepareJm(JM_ID[market], h1, nyBars)
  return findSignals({
    d,
    pair: JOHNS_METHOD.pair,
    expiry: JOHNS_METHOD.expiry,
    from: h1[0].time + WARMUP,
    to: nowSec,
  }).signals
}

/** The race stop a part is sized on: the real stop plus the race fee on both sides, so a stop-out costs its share. */
const sizeStop = (long: boolean, price: number, stop: number, feeRate: number) => {
  const fees = feeRate * (price + stop)
  return long ? stop - fees : stop + fees
}

/** Open parts as one exposure per market (the 5-trade limit counts trades, not parts). */
function exposures(open: LiveTrade[], riskOf: (t: LiveTrade) => number = tradeRisk): Exposure[] {
  const by = new Map<string, Exposure>()
  for (const t of open) {
    const e = by.get(t.market) ?? { margin: 0, riskUsd: 0 }
    by.set(t.market, { margin: e.margin + t.margin, riskUsd: e.riskUsd + riskOf(t) })
  }
  return [...by.values()]
}

/** The 120-candle time limit: the close of the 120th hourly candle from the first fill, once it exists. */
export function holdDeadline(h1: OHLCCandle[], fillHour: number): number | undefined {
  const k = h1.findIndex((c) => c.time >= fillHour)
  if (k < 0 || k + HOLD - 1 >= h1.length) return undefined
  return h1[k + HOLD - 1].time + HOUR
}

export type LadderEvent =
  | { kind: 'half2' | 'add'; k: number; T: number; P?: number }
  | { kind: 'over'; why: string }

/**
 * The ladder (SPEC 2.7 and 2.8) replayed on closed 1-hour candles after the
 * signal candle: at each close, over when it traded past 1, 24 candles
 * passed or 0 was reached; else the double down (two strong neighbours, the
 * first starting at or after the first fill), then half 2 (a reach of 0.886
 * without passing 1). Returns the first event not decided yet, or null.
 */
export function ladderEvent(
  h1: OHLCCandle[],
  atr1: number[],
  meta: JmPart,
  long: boolean,
  signalTime: number,
): LadderEvent | null {
  const si = h1.findIndex((c) => c.time === signalTime)
  if (si < 0) return { kind: 'over', why: 'signal candle no longer in the feed' }
  const strong = (q: number) => {
    const c = h1[q]
    const way = long ? c.close > c.open : c.close < c.open
    return way && Math.abs(c.close - c.open) >= JM.strongBody * atr1[q]
  }
  for (let k = si + 1; k < h1.length; k++) {
    const b = h1[k]
    if (long ? b.low < meta.one : b.high > meta.one) return { kind: 'over', why: 'traded past 1' }
    if (k - si >= JM.ladderLife) return { kind: 'over', why: '24 candles passed' }
    if (long ? b.high >= meta.zero : b.low <= meta.zero) return { kind: 'over', why: 'reached 0' }
    if (
      meta.add === 'none' &&
      h1[k - 1].time >= meta.fillHour &&
      b.time - h1[k - 1].time === HOUR &&
      strong(k - 1) &&
      strong(k)
    ) {
      let P = long ? Infinity : -Infinity
      for (let q = si; q <= k; q++) P = long ? Math.min(P, h1[q].low) : Math.max(P, h1[q].high)
      return { kind: 'add', k, T: b.time + HOUR, P }
    }
    if (meta.half2 === 'none' && (long ? b.low <= meta.l886 : b.high >= meta.l886))
      return { kind: 'half2', k, T: b.time + HOUR }
  }
  return null
}

const PART_WORDS: Record<JmPart['part'], string> = {
  half1: 'Half 1 at 0.786 (1% risk)',
  both: 'Both halves at once: the signal candle reached 0.886 (2% risk)',
  half2: 'Half 2 at 0.886 (1% risk)',
  add: 'Double down after two strong candles (up to 2% for the whole trade)',
}

/**
 * One check of the account: exits of every open part (stop, half at 0, the
 * rest at -0.272, the time limit), then per market the ladder of an open
 * trade or a new signal. `blockNew` (the forex weekend) stops new parts.
 * `news`: red events, only written on a part that opens within 30 minutes
 * of one (SPEC 2.11: a field, not a rule).
 */
export function stepJohnsMethod(
  s: RaceStrategy,
  inputs: JmMarketInput[],
  nowSec: number,
  blockNew: string | null = null,
  news: NewsEvent[] = [],
): JmStep {
  const byMarket = new Map(inputs.map((m) => [m.market as string, m]))
  let balance = s.balance
  let open: LiveTrade[] = []
  const closed: ClosedLiveTrade[] = []
  const opened: LiveTrade[] = []
  const passed: StepResult['passed'] = []
  const notes: JmStep['notes'] = []
  const note = (market: string, text: string) => notes.push({ market, note: text })
  const x = hourMult(nowSec, false)

  // 1. Exits. The time limit is set once its 120th candle has closed.
  for (const t0 of s.open) {
    const m = byMarket.get(t0.market)
    if (!m) {
      open.push(t0)
      continue
    }
    const deadline = t0.jm ? holdDeadline(m.h1, t0.jm.fillHour) : undefined
    const t = deadline != null ? { ...t0, deadline } : t0
    const r = tradeExits(t, m, nowSec)
    for (const c of r.closed) {
      balance += c.pnl
      closed.push(c)
    }
    if (r.open) open.push(r.open)
  }
  const allClosed = [...s.closed, ...closed]

  /** Size and open one part at the price now, to `stop`, risking `riskUsd`. Null when it opened, else why not. */
  const openPart = (
    m: JmMarketInput,
    meta: JmPart,
    long: boolean,
    signalTime: number,
    stop: number,
    tp2: number,
    riskUsd: number,
    openRisk: (t: LiveTrade) => number = tradeRisk,
  ): string | null => {
    if (m.usdPerQuote == null) return 'no USD rate for its quote currency'
    const size = sizeRaceTrade({
      balance,
      open: exposures(open, openRisk),
      entry: m.price,
      stop: sizeStop(long, m.price, stop, m.feeRate),
      usdPerQuote: m.usdPerQuote,
      leverage: m.leverage,
      sizing: {
        riskPct: (riskUsd / balance) * 100,
        // The 5-trade limit is for new trades; a half or an add joins one already open.
        maxOpen: meta.part === 'half1' || meta.part === 'both' ? JM.maxOpen : 99,
        maxOpenRiskPct: JM.maxOpenRisk * 100,
      },
    })
    if (!size.ok) return size.reason
    if (size.capped && size.riskUsd < JM.marginFloor * riskUsd) return 'no free margin'
    const near = news.some(
      (e) =>
        JM_MARKET[JM_ID[m.market]].news.includes(e.currency) &&
        Math.abs(e.time - nowSec) <= JM.newsPad,
    )
    const t: LiveTrade = {
      market: m.market,
      direction: long ? 'long' : 'short',
      signalTime,
      entryTime: nowSec,
      entryBucket: m.path.at(-1)?.time ?? nowSec,
      entry: m.price,
      stop,
      takeProfit: tp2,
      units: size.units,
      usdPerQuote: m.usdPerQuote,
      margin: size.margin,
      entryFee: size.valueUsd * m.feeRate,
      note: `${PART_WORDS[meta.part]}${near ? ', red news within 30 minutes' : ''}`,
      target1: meta.zero,
      part1: 0.5,
      jm: meta,
    }
    open.push(t)
    opened.push(t)
    return null
  }

  const lastSignal = { ...s.lastSignal }
  for (const m of inputs) {
    const id = m.market
    const jm = JM_MARKET[JM_ID[id]]
    const sigs = jmSignals(id, m.h1, nowSec)
    const sig = sigs
      .filter((g) => g.sigTime > (lastSignal[id] ?? 0) && nowSec - g.T <= FILL_WAIT)
      .at(-1)
    if (sig) lastSignal[id] = sig.sigTime
    const what = sig
      ? `${sig.long ? 'BUY' : 'SELL'} signal on the ${hhmm(sig.sigTime)} UTC candle (1 ${+sig.one.toPrecision(6)}, 0 ${+sig.zero.toPrecision(6)})`
      : ''
    const pass = (why: string) => passed.push({ market: id, reason: `${what}: ${why}` })
    const mine = open.filter((t) => t.market === id)

    // 2a. A trade is open: its ladder. A new signal here is used up (market busy).
    if (mine.length) {
      if (sig) pass('a trade is already open in this market')
      const t0 = mine[0]
      if (!t0.jm || t0.jm.ladder !== 'alive') continue
      const long = t0.direction === 'long'
      const set = (patch: Partial<JmPart>, stop?: number) => {
        open = open.map((t) =>
          t.market === id && t.jm
            ? { ...t, jm: { ...t.jm, ...patch }, ...(stop != null ? { stop } : {}) }
            : t,
        )
      }
      const tp1Paid = allClosed.some(
        (c) => c.market === id && c.signalTime === t0.signalTime && c.part1Of != null,
      )
      if (tp1Paid) {
        set({
          ladder: 'over: reached 0',
          ...(t0.jm.half2 === 'none' ? { half2: 'cancelled' } : {}),
        })
        continue
      }
      const d = prepareJm(JM_ID[id], m.h1, (c, sec) =>
        closedOnly(nyCloseBars(c, sec), sec / HOUR, nowSec),
      )
      for (;;) {
        const cur = open.find((t) => t.market === id)!.jm!
        if (cur.ladder !== 'alive') break
        const ev = ladderEvent(m.h1, d.h1.atr, cur, long, t0.signalTime)
        if (!ev) break
        if (ev.kind === 'over') {
          set({
            ladder: `over: ${ev.why}`,
            ...(cur.half2 === 'none' ? { half2: 'cancelled' } : {}),
          })
          note(id, `ladder over: ${ev.why}`)
          break
        }
        const late = nowSec - ev.T > FILL_WAIT ? 'missed (no check within 2 hours)' : blockNew
        if (ev.kind === 'half2') {
          let why = late
          if (!why) {
            const E = entryFill(jm, long, m.price, x)
            if (Math.abs(E - cur.S) < JM.costFloorX * roundTrip(jm, m.price)) why = 'cost floor'
            else if (!noChase(jm, long, E, m.h1[ev.k].close, cur.S, cur.zero, t0.takeProfit))
              why = 'chase'
            else
              why = openPart(
                m,
                { ...cur, part: 'half2', half2: 'filled' },
                long,
                t0.signalTime,
                cur.S,
                t0.takeProfit,
                JM.halfRisk * balance,
              )
          }
          set({ half2: why ? `failed: ${why}` : 'filled' })
          note(id, why ? `half 2 not opened: ${why}` : 'half 2 opened at 0.886')
          // A missed half 2 leaves the ladder alive for the double down; an opened one waits for the next check.
          if (why && late) continue
          break
        }
        // The double down (SPEC 2.8, capped C). Half 2 is cancelled; the ladder is over either way.
        const done: Partial<JmPart> = {
          ladder: 'over: double down',
          ...(cur.half2 === 'none' ? { half2: 'cancelled' } : {}),
        }
        let why = late
        let S2: number | undefined
        if (!why) {
          const E = entryFill(jm, long, m.price, x)
          const floor = JM.costFloorX * roundTrip(jm, m.price)
          const pad = JM.stopPadAtr * atrAt(d.h4, ev.T)
          const dd = long ? Math.max(E - (ev.P! - pad), floor) : Math.max(ev.P! + pad - E, floor)
          const s2 = long ? Math.max(cur.S, E - dd) : Math.min(cur.S, E + dd)
          const tp1 = cur.zero
          const tp2 = t0.takeProfit
          // Capped: the whole trade risks 2% at most, its open parts measured to S2.
          const want =
            JM.fullRisk * balance -
            open
              .filter((t) => t.market === id)
              .reduce(
                (a, t) =>
                  a +
                  t.units * (Math.abs(t.entry - s2) + m.feeRate * (t.entry + s2)) * t.usdPerQuote,
                0,
              )
          if (!(pad > 0)) why = 'no 4-hour ATR'
          else if (!targetsOk(long, E, tp1, tp2)) why = 'targets on the wrong side'
          else if (Math.abs(E - s2) < floor) why = 'cost floor'
          else if (plan(E, s2, tp1, tp2).rr < JM.rrMin) why = 'plan under 1.5R'
          else if (!noChase(jm, long, E, m.h1[ev.k].close, s2, tp1, tp2)) why = 'chase'
          else if (!(want > 1e-9)) why = 'trade already at 2%'
          else {
            why = openPart(
              m,
              { ...cur, ...done, part: 'add', add: 'opened' },
              long,
              t0.signalTime,
              s2,
              tp2,
              want,
              (t) =>
                t.market === id ? t.units * Math.abs(t.entry - s2) * t.usdPerQuote : tradeRisk(t),
            )
            if (!why) S2 = s2
          }
        }
        set({ ...done, add: why ? `failed: ${why}` : 'opened' }, S2)
        note(
          id,
          why
            ? `double down not opened: ${why}`
            : `double down opened, stop moved to ${+S2!.toPrecision(6)}`,
        )
        break
      }
      continue
    }

    // 2b. No trade open: a new signal opens half 1 (or both halves) at the price now.
    if (!sig) {
      note(id, sigs.length ? 'no new signal' : 'no signal in the feed yet')
      continue
    }
    if (sig.check === 'both sides at once') {
      pass('both sides signalled at once')
      continue
    }
    if (blockNew) {
      pass(blockNew)
      continue
    }
    if (!(m.price > 0)) {
      pass('no price')
      continue
    }
    const long = sig.long
    const E1 = entryFill(jm, long, m.price, x)
    const pl = plan(E1, sig.S, sig.tp1, sig.tp2)
    let why: string | null = null
    if ((long ? E1 - sig.S : sig.S - E1) < JM.costFloorX * roundTrip(jm, m.price))
      why = 'stop too close for the costs'
    else if (!targetsOk(long, E1, sig.tp1, sig.tp2)) why = 'targets on the wrong side of the price'
    else if (pl.rr < JM.rrMin) why = `plan ${pl.rr.toFixed(2)}R, under 1.5R`
    else if (!noChase(jm, long, E1, sig.close, sig.S, sig.tp1, sig.tp2))
      why = 'no chase: the price ran from the signal close'
    else {
      const direction = long ? 'long' : 'short'
      // The race's rules for new trades, and the spec's one dollar bet: never both sides of it.
      const sign = (t: { market: string; direction: string }) =>
        (DOLLAR[t.market] ?? 0) * (t.direction === 'long' ? 1 : -1)
      const against = open.find(
        (t) => sign(t) !== 0 && sign(t) === -sign({ market: id, direction }),
      )
      why =
        newTradeBlock({ market: id, direction }, open) ??
        (against
          ? `against the open ${against.market} ${against.direction} (never both sides of the dollar)`
          : null)
    }
    if (!why) {
      const both = sig.reached886
      why = openPart(
        m,
        {
          part: both ? 'both' : 'half1',
          one: sig.one,
          zero: sig.zero,
          l886: sig.L886,
          S: sig.S,
          fillHour: nowSec - (nowSec % HOUR),
          half2: both ? 'together' : 'none',
          add: 'none',
          ladder: 'alive',
        },
        long,
        sig.sigTime,
        sig.S,
        sig.tp2,
        (both ? JM.fullRisk : JM.halfRisk) * balance,
      )
    }
    if (why) pass(why)
    else
      note(
        id,
        `${what}: ${sig.reached886 ? 'both halves' : 'half 1'} opened, plan ${pl.rr.toFixed(2)}R`,
      )
  }

  return {
    strategy: { ...s, balance, open, lastSignal, closed: allClosed },
    opened,
    closed,
    passed,
    wicks: [],
    notes,
  }
}
