import { describe, expect, it } from 'vitest'
import {
  callLive,
  cancelCall,
  JOHNS_CALLS,
  legsOf,
  planCall,
  stepCalls,
  withJohnsCalls,
  type CallInput,
} from './johnsCalls'
import type { Call } from './callSchema'
import { bookCloseRequests, tradeId, type Minute } from './closeRequests'
import { compareRows, EVIDENCE_TEXT } from './compare'
import { createRaceState, parseRaceState, type RaceState } from './live'

/** Unix seconds of a Puerto Rico (AST = UTC-4) wall clock time on Thu 2026-11-12. */
const at = (h: number, mi: number, s = 0) => Date.UTC(2026, 10, 12, h + 4, mi, s) / 1000
const NOW = at(9, 50, 20)

const PRICES = {
  'pax-gold': 3910,
  bitcoin: 72_000,
  'GBP-USD': 1.3,
  'EUR-GBP': 0.88,
  'USD-JPY': 155,
}

function race(): RaceState {
  const s = createRaceState([{ id: 'ema50-pullback', name: 'EMA 50 pullback' }], 10_000)
  return withJohnsCalls({ ...s, prices: PRICES }).state
}

const GOLD: CallInput = {
  market: 'pax-gold',
  side: 'long',
  entries: '3905,3895,3885',
  stop: '3855',
  targets: '4134,4200',
}

/** A saved call (planCall must accept it). */
function call(input: CallInput, state = race(), now = NOW): Call {
  const r = planCall(input, state, now)
  if (!r.ok) throw new Error(r.errors.join('; '))
  return r.call
}

/** One minute: open, high, low (high and low default to the open). */
const min = (t: number, o: number, h = o, l = o): Minute => ({ t, o, h, l })
/** Flat minutes at `p` from `from` to `to`, both included. */
const flat = (from: number, to: number, p: number) => {
  const out: Minute[] = []
  for (let t = from; t <= to; t += 60) out.push(min(t, p))
  return out
}

/** One race check of John's calls with these minutes for the call's market. */
function step(state: RaceState, calls: Call[], minutes: Minute[], nowSec: number) {
  return stepCalls({
    account: state.strategies[JOHNS_CALLS.id],
    calls,
    minutes: () => minutes,
    nowSec,
    usdPerQuote: () => 1,
  })
}

describe("John's calls: the account", () => {
  it('joins with $10,000 and leaves the other accounts alone', () => {
    const s = createRaceState([{ id: 'ema50-pullback', name: 'EMA 50 pullback' }], 10_000)
    const r = withJohnsCalls(s)
    expect(r.added).toBe(true)
    expect(r.state.strategies[JOHNS_CALLS.id]).toMatchObject({
      name: "John's calls",
      balance: 10_000,
      open: [],
      closed: [],
    })
    expect(r.state.strategies['ema50-pullback']).toBe(s.strategies['ema50-pullback'])
    expect(withJohnsCalls(r.state).added).toBe(false)
  })

  it('a race file with calls reads back the same', () => {
    const s = { ...race(), calls: [call(GOLD)] }
    const parsed = parseRaceState(JSON.parse(JSON.stringify(s)))
    expect(parsed.ok && parsed.state.calls).toEqual(s.calls)
  })
})

describe("John's calls: making a call", () => {
  it('sizes each entry with an equal share of the risk, rounded down to the lot step', () => {
    const c = call(GOLD)
    // $200 (2%) over 3 entries: $66.67 each. Gold's lot step is 1 oz (0.01 lot).
    // 66.67 / 50 = 1.33 -> 1 oz, 66.67 / 40 = 1.67 -> 1 oz, 66.67 / 30 = 2.22 -> 2 oz.
    expect(c.orders.map((o) => [o.entry, o.units, o.status])).toEqual([
      [3905, 1, 'pending'],
      [3895, 1, 'pending'],
      [3885, 2, 'pending'],
    ])
    const risk = c.orders.reduce((a, o) => a + o.units * (o.entry - c.stop), 0)
    expect(risk).toBe(150)
    expect(risk).toBeLessThanOrEqual(200)
    expect(c).toMatchObject({
      id: '1',
      direction: 'long',
      split: [50, 50],
      riskPct: 2,
      madeAt: NOW,
      expiresAt: NOW + 72 * 3600,
      // The minute the call was made in started before it.
      checkedTo: at(9, 51),
    })
  })

  it('half at the first target and the rest at the last, each rounded down to the lot step', () => {
    // 1 oz cannot be halved (0.5 oz is under 0.01 lot): all of it at the last target.
    expect(call(GOLD).orders.map((o) => o.legs)).toEqual([
      [0, 1],
      [0, 1],
      [1, 1],
    ])
    expect(legsOf('GBP-USD', 25_000, [50, 50])).toEqual([12_000, 13_000])
    expect(legsOf('bitcoin', 0.1, [50, 0, 50])).toEqual([0.05, 0, 0.05])
    expect(legsOf('bitcoin', 0.1, [100])).toEqual([0.1])
  })

  it('rounds forex down to 1,000 units', () => {
    const c = call({
      market: 'GBP-USD',
      side: 'short',
      entries: '1.305',
      stop: '1.312',
      targets: '1.29',
    })
    // $200 / 0.007 = 28,571 units -> 28,000.
    expect(c.orders[0].units).toBe(28_000)
    expect(c.orders[0].legs).toEqual([28_000])
  })

  it('takes a SPLIT per target and numbers calls one after another', () => {
    const s = race()
    const first = call(GOLD, s)
    const second = call(
      { ...GOLD, entries: '3900', targets: '4000,4100,4200', split: '50,25,25' },
      { ...s, calls: [first] },
    )
    expect(second.id).toBe('2')
    expect(second.split).toEqual([50, 25, 25])
    // $200 / $45 = 4.44 -> 4 oz: 2 at the first, 1 at the second, the rest (1) at the last.
    expect(second.orders[0]).toMatchObject({ units: 4, legs: [2, 1, 1] })
  })

  it('lists every mistake at once', () => {
    const r = planCall(
      { market: 'pax-gold', side: 'long', entries: '3905,3895', stop: '3900', targets: '3890' },
      race(),
      NOW,
    )
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors).toEqual([
      'STOP must be below every entry for a long',
      'TARGETS must all be above every entry for a long',
    ])
  })

  it.each([
    [{ ...GOLD, market: 'USD-JPY' }, 'no new trades on USD-JPY'],
    [{ ...GOLD, market: 'NZD-USD' }, 'no new trades on NZD-USD'],
    [{ ...GOLD, market: 'US30' }, 'not a market here'],
    [{ ...GOLD, market: 'ethereum' }, 'no live price for ethereum'],
    [{ ...GOLD, side: 'buy' }, 'SIDE must be long or short'],
    [{ ...GOLD, entries: '' }, 'ENTRIES'],
    [{ ...GOLD, entries: '3905,abc' }, 'ENTRIES'],
    [{ ...GOLD, stop: '' }, 'STOP'],
    [{ ...GOLD, side: 'short' }, 'STOP must be above every entry for a short'],
    [{ ...GOLD, targets: '4200,4134' }, 'TARGETS go nearest first'],
    [{ ...GOLD, risk: '0' }, 'RISK'],
    [{ ...GOLD, risk: '12' }, 'RISK'],
    [{ ...GOLD, split: '50' }, 'SPLIT needs one % per target (2)'],
    [{ ...GOLD, split: '60,60' }, 'SPLIT must add up to 100'],
    [{ ...GOLD, expires: '-1' }, 'EXPIRES'],
    [{ ...GOLD, entries: '3856', risk: '0.001' }, 'buys less than 0.01 lot'],
  ])('refuses %#: %s', (input, error) => {
    const r = planCall(input, race(), NOW)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors.join(' | ')).toContain(error)
  })

  it('caps the risk of every open and waiting call together at 10% of the balance', () => {
    const s = race()
    const big = call({ ...GOLD, risk: '9' }, s)
    const r = planCall({ ...GOLD, risk: '2' }, { ...s, calls: [big] }, NOW)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors[0]).toContain('open risk would pass 10%')
    // A cancelled call frees its risk.
    const freed = cancelCall([big], big.id, NOW)
    expect(freed.ok && planCall({ ...GOLD, risk: '2' }, { ...s, calls: freed.calls }, NOW).ok).toBe(
      true,
    )
  })

  it('refuses a call the free margin cannot hold if every entry fills', () => {
    // Bitcoin at 1:1: a stop $500 away at 2% is 0.4 BTC, $28,000 of a $10,000 account.
    const r = planCall(
      { market: 'bitcoin', side: 'long', entries: '70000', stop: '69500', targets: '72000' },
      race(),
      NOW,
    )
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors[0]).toContain('not enough free margin')
  })
})

describe("John's calls: fills", () => {
  it('a ladder of 3 entries fills one by one, each at its own price, entry fee charged', () => {
    const s = race()
    const c = call(GOLD, s)
    // Check 1: down to 3904 fills 3905 only.
    const m1 = [...flat(at(9, 51), at(9, 59), 3910), min(at(10, 0), 3908, 3909, 3904)]
    const r1 = step(s, [c], m1, at(10, 1))
    expect(r1.filled.map((t) => [t.entry, t.units, t.entryTime])).toEqual([[3905, 1, at(10, 0)]])
    expect(r1.filled[0]).toMatchObject({
      direction: 'long',
      stop: 3855,
      takeProfit: 4200,
      signalTime: NOW,
      entryFee: 3905 * 0.0002,
      margin: 3905 / 20,
      call: { id: '1', size: 1, legs: [{ price: 4200, units: 1 }] },
    })
    expect(r1.calls[0].orders.map((o) => o.status)).toEqual(['filled', 'pending', 'pending'])
    expect(r1.calls[0].checkedTo).toBe(at(10, 1))
    // Check 2: 3894 fills 3895.
    const s2 = { ...s, strategies: { ...s.strategies, [JOHNS_CALLS.id]: r1.account } }
    const r2 = step(s2, r1.calls, [...m1, min(at(10, 1), 3900, 3901, 3894)], at(10, 2))
    expect(r2.filled.map((t) => t.entry)).toEqual([3895])
    // Check 3: 3884 fills 3885 (2 oz).
    const s3 = { ...s, strategies: { ...s.strategies, [JOHNS_CALLS.id]: r2.account } }
    const r3 = step(s3, r2.calls, [min(at(10, 2), 3890, 3891, 3884)], at(10, 3))
    expect(r3.filled.map((t) => [t.entry, t.units])).toEqual([[3885, 2]])
    expect(r3.account.open).toHaveLength(3)
    expect(r3.calls[0].orders.every((o) => o.status === 'filled')).toBe(true)
    // Fees are paid at the close, like every race trade: the balance has not moved.
    expect(r3.account.balance).toBe(10_000)
  })

  it('never fills on a touch before the call (no hindsight), nor in the minute it was made', () => {
    const s = race()
    const c = call(GOLD, s)
    const minutes = [
      min(at(9, 49), 3904, 3904, 3880), // before the call: all three touched
      min(at(9, 50), 3904, 3904, 3880), // the call's own minute, started before it
      ...flat(at(9, 51), at(9, 55), 3910),
    ]
    const r = step(s, [c], minutes, at(9, 56))
    expect(r.filled).toEqual([])
    expect(r.calls[0].orders.every((o) => o.status === 'pending')).toBe(true)
    expect(r.calls[0].checkedTo).toBe(at(9, 56))
  })

  it('only looks at minutes that have closed', () => {
    const s = race()
    const c = call(GOLD, s)
    // The 9:51 minute is still forming at 9:51:30: it waits for the next check.
    const r = step(s, [c], [min(at(9, 51), 3906, 3906, 3900)], at(9, 51, 30))
    expect(r.filled).toEqual([])
    expect(r.calls[0].checkedTo).toBe(at(9, 51))
  })

  it('a buy limit above the price fills at the next minute open', () => {
    const s = { ...race(), prices: { ...PRICES, 'pax-gold': 3880 } }
    const c = call(GOLD, s)
    const r = step(s, [c], [min(at(9, 51), 3881, 3884, 3879)], at(9, 52))
    // 3905 and 3895 are above the price: both at the open. 3885: the minute reached it, at 3885?
    // No: the open (3881) was already below 3885, so it fills at the open too.
    expect(r.filled.map((t) => t.entry)).toEqual([3881, 3881, 3881])
    // One minute, three trades: each gets its own entry time (a trade's id is market + entry time).
    expect(r.filled.map((t) => t.entryTime)).toEqual([at(9, 51), at(9, 51, 1), at(9, 51, 2)])
  })

  it('a minute that gaps past the entry fills at its open, not at the limit', () => {
    const s = race()
    const c = call({ ...GOLD, entries: '3905' }, s)
    const r = step(s, [c], [min(at(9, 51), 3901, 3903, 3899)], at(9, 52))
    expect(r.filled.map((t) => t.entry)).toEqual([3901])
  })

  it('a short sells at its limit when the price rises to it', () => {
    const s = race()
    const c = call(
      {
        market: 'GBP-USD',
        side: 'short',
        entries: '1.305',
        stop: '1.312',
        targets: '1.29',
      },
      s,
    )
    const r = step(s, [c], [min(at(9, 51), 1.3, 1.3052, 1.2995)], at(9, 52))
    expect(r.filled.map((t) => [t.direction, t.entry])).toEqual([['short', 1.305]])
  })

  it('cancels what has not filled at EXPIRES', () => {
    const s = race()
    const c = call({ ...GOLD, expires: '1' }, s)
    const r = step(
      s,
      [c],
      [...flat(at(9, 51), at(10, 50), 3910), min(at(10, 51), 3900, 3900, 3880)],
      at(10, 52),
    )
    expect(r.filled).toEqual([])
    expect(r.calls[0].orders.map((o) => [o.status, o.why])).toEqual([
      ['cancelled', 'expired before it filled'],
      ['cancelled', 'expired before it filled'],
      ['cancelled', 'expired before it filled'],
    ])
    expect(callLive(r.calls[0], r.account.open)).toBe(false)
  })
})

describe("John's calls: stop and targets", () => {
  /** The gold ladder with the first two entries filled at 10:00 and 10:01. */
  function twoFilled() {
    const s = race()
    const c = call(GOLD, s)
    const r = step(
      s,
      [c],
      [
        ...flat(at(9, 51), at(9, 59), 3910),
        min(at(10, 0), 3908, 3908, 3904),
        min(at(10, 1), 3900, 3900, 3894),
      ],
      at(10, 2),
    )
    expect(r.account.open).toHaveLength(2)
    return { s: { ...s, strategies: { ...s.strategies, [JOHNS_CALLS.id]: r.account } }, r }
  }

  it('one stop for every entry: the open ones close there, the last fills and closes too', () => {
    const { s, r } = twoFilled()
    const r2 = step(s, r.calls, [min(at(10, 2), 3893, 3893, 3850)], at(10, 3))
    // The minute went through 3885 to get to the stop: it filled, then stopped.
    expect(r2.filled.map((t) => t.entry)).toEqual([3885])
    expect(r2.closed.map((t) => [t.entry, t.exit, t.reason])).toEqual([
      [3905, 3855, 'stop'],
      [3895, 3855, 'stop'],
      [3885, 3855, 'stop'],
    ])
    expect(r2.account.open).toEqual([])
    // -$150 at the stop plus both fees on 4 oz.
    const fees = r2.closed.reduce((a, t) => a + t.fees, 0)
    expect(r2.account.balance).toBeCloseTo(10_000 - 150 - fees, 6)
  })

  it('a minute that opens past the stop cancels what is waiting and closes at that open', () => {
    const { s, r } = twoFilled()
    const r2 = step(s, r.calls, [min(at(10, 2), 3850, 3852, 3840)], at(10, 3))
    expect(r2.filled).toEqual([])
    expect(r2.closed.map((t) => [t.exit, t.reason])).toEqual([
      [3850, 'stop'],
      [3850, 'stop'],
    ])
    expect(r2.cancelled).toEqual([
      { call: '1', entry: 3885, why: 'the stop was hit before it filled' },
    ])
  })

  it('the stop wins a minute that reaches both stop and target', () => {
    const s = race()
    const c = call(
      { market: 'bitcoin', side: 'long', entries: '70000', stop: '68000', targets: '74000' },
      s,
    )
    const r = step(s, [c], [min(at(9, 51), 70500, 70500, 69900)], at(9, 52))
    const s2 = { ...s, strategies: { ...s.strategies, [JOHNS_CALLS.id]: r.account } }
    const r2 = step(s2, r.calls, [min(at(9, 52), 70000, 74500, 67900)], at(9, 53))
    expect(r2.closed.map((t) => [t.exit, t.reason])).toEqual([[68000, 'stop']])
  })

  it('half closes at the first target, the rest at the last', () => {
    const s = race()
    // Bitcoin has no lot step: $200 / $2,000 = 0.1 BTC, 0.05 at each target.
    const c = call(
      {
        market: 'bitcoin',
        side: 'long',
        entries: '70000',
        stop: '68000',
        targets: '74000,76000',
        note: 'BTC bounce off 70k',
      },
      s,
    )
    expect(c.orders[0]).toMatchObject({ units: 0.1, legs: [0.05, 0.05] })
    const r = step(s, [c], [min(at(9, 51), 70500, 70500, 69900)], at(9, 52))
    expect(r.filled[0].note).toBe('BTC bounce off 70k')
    // The fill minute itself never counts for a target.
    const s2 = { ...s, strategies: { ...s.strategies, [JOHNS_CALLS.id]: r.account } }
    const r2 = step(s2, r.calls, [min(at(9, 52), 72000, 74100, 71900)], at(9, 53))
    expect(r2.closed).toHaveLength(1)
    expect(r2.closed[0]).toMatchObject({ exit: 74000, reason: 'target', units: 0.05, part1Of: 0.5 })
    expect(r2.account.open[0]).toMatchObject({
      units: 0.05,
      call: { legs: [{ price: 76000, units: 0.05 }] },
    })
    expect(r2.closed[0].pnl).toBeCloseTo(0.05 * 4000 - 0.05 * 70000 * 0.001 - 0.05 * 74000 * 0.001)
    const s3 = { ...s, strategies: { ...s.strategies, [JOHNS_CALLS.id]: r2.account } }
    const r3 = step(s3, r2.calls, [min(at(9, 53), 75000, 76500, 74900)], at(9, 54))
    expect(r3.closed.map((t) => [t.exit, t.units, t.part1Of])).toEqual([[76000, 0.05, undefined]])
    expect(r3.account.open).toEqual([])
    // Whole-trade stats see one trade: both parts share the entry.
    const row = compareRows(
      { ...s, strategies: { ...s.strategies, [JOHNS_CALLS.id]: r3.account }, calls: r3.calls },
      at(10, 0) * 1000,
    ).find((x) => x.id === JOHNS_CALLS.id)!
    expect(row.stats.trades).toBe(1)
    expect(row.stats.wins).toBe(1)
  })
})

describe("John's calls: cancel and Close now", () => {
  it('cancel takes the waiting orders off; filled trades keep running', () => {
    const s = race()
    const c = call(GOLD, s)
    const r = step(s, [c], [min(at(9, 51), 3906, 3906, 3904)], at(9, 52))
    const x = cancelCall(r.calls, '1', at(9, 53))
    expect(x.ok && x.cancelled).toBe(2)
    expect(x.ok && x.calls[0].orders.map((o) => [o.status, o.why])).toEqual([
      ['filled', undefined],
      ['cancelled', 'cancelled by you'],
      ['cancelled', 'cancelled by you'],
    ])
    expect(r.account.open).toHaveLength(1)
    expect(cancelCall(r.calls, '9', NOW)).toEqual({ ok: false, error: 'no call #9' })
    expect(x.ok && cancelCall(x.calls, '1', NOW)).toEqual({
      ok: false,
      error: 'call #1 has no orders waiting',
    })
  })

  it('Close now books a call trade at the minute of the tap', () => {
    const s = race()
    const c = call(GOLD, s)
    const r = step(s, [c], [min(at(9, 51), 3906, 3906, 3904)], at(9, 52))
    const state = { ...s, strategies: { ...s.strategies, [JOHNS_CALLS.id]: r.account } }
    const id = tradeId(JOHNS_CALLS.id, r.filled[0])
    const booked = bookCloseRequests(
      state,
      { [id]: { id, at: at(10, 4, 30) * 1000 } },
      () => flat(at(9, 52), at(10, 6), 3912),
      at(9, 45),
      () => 0.0002,
    )
    expect(booked.booked.map((b) => [b.account, b.closed.exit, b.closed.reason])).toEqual([
      [JOHNS_CALLS.id, 3912, 'manual'],
    ])
    expect(booked.state.strategies[JOHNS_CALLS.id].open).toEqual([])
  })
})

describe("John's calls on Compare", () => {
  it('has its own row, tagged "Your calls", with its calls', () => {
    const s = race()
    const c = call(GOLD, s)
    const row = compareRows({ ...s, calls: [c] }, at(10, 0) * 1000).find(
      (x) => x.id === JOHNS_CALLS.id,
    )!
    expect(row.name).toBe("John's calls")
    expect(EVIDENCE_TEXT[row.past.evidence]).toBe('Your calls')
    expect(row.calls).toEqual([c])
    expect(row.since).toBe(NOW * 1000)
    expect(row.pnl).toBe(0)
    // The other rows carry no calls.
    expect(compareRows(s, 0).find((x) => x.id === 'ema50-pullback')?.calls).toBeUndefined()
  })
})
