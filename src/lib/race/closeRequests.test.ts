import { describe, expect, it } from 'vitest'
import {
  bookCloseRequests,
  CLOSE_ID,
  decideClose,
  findOpen,
  FUNDED_ACCOUNT,
  tradeId,
  type CloseRequests,
  type Minute,
} from './closeRequests'
import { createFunded, fundedAccountId } from './funded'
import { createRaceState, type FundedTrade, type LiveTrade } from './live'
// The relay worker is plain JS (race-worker/), tested here with a fake KV.
import worker from '../../../race-worker/worker.js'

/** Unix seconds of a Puerto Rico (AST = UTC-4) wall clock time on Wed 2026-11-11. */
const at = (h: number, mi: number, s = 0) => Date.UTC(2026, 10, 11, h + 4, mi, s) / 1000

const gbp: LiveTrade = {
  market: 'GBP-USD',
  direction: 'long',
  signalTime: at(9, 50),
  entryTime: at(10, 0, 20),
  entryBucket: at(10, 0),
  entry: 1.3,
  stop: 1.29,
  takeProfit: 1.32,
  units: 20_000,
  usdPerQuote: 1,
  margin: 866.67,
  entryFee: 1.82,
}
/** One flat minute at `p`, or with its own high and low. */
const min = (t: number, o: number, h = o, l = o): Minute => ({ t, o, h, l })
const quiet = (from: number, to: number, p = 1.302) => {
  const out: Minute[] = []
  for (let t = from; t <= to; t += 60) out.push(min(t, p))
  return out
}

describe('Close now: which price', () => {
  const FROM = at(10, 0) // the last check's quarter hour

  it('fills at the open of the first 1-minute candle at or after the tap', () => {
    const mins = quiet(at(10, 0), at(10, 20)).map((m) =>
      m.t === at(10, 15) ? min(m.t, 1.3055) : m,
    )
    const tap = at(10, 14, 20) * 1000
    expect(decideClose(gbp, tap, mins, undefined, FROM)).toEqual({
      kind: 'close',
      exit: 1.3055,
      time: at(10, 15),
      reason: 'manual',
    })
    // a tap right on the minute takes that minute
    expect(decideClose(gbp, at(10, 15) * 1000, mins, undefined, FROM)).toMatchObject({
      exit: 1.3055,
      time: at(10, 15),
    })
  })

  it('a stop touched between the last check and the tap wins', () => {
    const mins = quiet(at(10, 0), at(10, 20))
    mins[5] = min(at(10, 5), 1.291, 1.291, 1.2895) // touches 1.29
    expect(decideClose(gbp, at(10, 14) * 1000, mins, undefined, FROM)).toEqual({
      kind: 'close',
      exit: 1.29,
      time: at(10, 5),
      reason: 'stop',
    })
    // a gap through the stop fills at that minute's open
    mins[5] = min(at(10, 5), 1.288, 1.289, 1.287)
    expect(decideClose(gbp, at(10, 14) * 1000, mins, undefined, FROM)).toMatchObject({
      exit: 1.288,
      reason: 'stop',
    })
    // the target too
    mins[5] = min(at(10, 5), 1.315, 1.3205, 1.315)
    expect(decideClose(gbp, at(10, 14) * 1000, mins, undefined, FROM)).toMatchObject({
      exit: 1.32,
      reason: 'target',
    })
  })

  it('a stop touched after the tap does not matter: the tap came first', () => {
    const mins = quiet(at(10, 0), at(10, 20))
    mins[16] = min(at(10, 16), 1.291, 1.291, 1.28)
    expect(decideClose(gbp, at(10, 14, 30) * 1000, mins, undefined, FROM)).toMatchObject({
      reason: 'manual',
      time: at(10, 15),
    })
  })

  it('ignores minutes the last check already saw and the minute the trade opened in', () => {
    const mins = [
      min(at(9, 59), 1.28),
      min(at(10, 0), 1.3, 1.3, 1.285),
      ...quiet(at(10, 1), at(10, 5)),
    ]
    expect(decideClose(gbp, at(10, 3) * 1000, mins, undefined, at(9, 45))).toMatchObject({
      reason: 'manual',
      exit: 1.302,
    })
  })

  it('waits when the minute of the tap is not printed yet', () => {
    expect(
      decideClose(gbp, at(10, 14) * 1000, quiet(at(10, 0), at(10, 13)), undefined, FROM),
    ).toEqual({
      kind: 'wait',
    })
  })

  it("markets without 1-minute candles close at the race's own price", () => {
    const jpy = { ...gbp, market: 'USD-JPY', entry: 155, stop: 154, takeProfit: 157 }
    expect(decideClose(jpy, at(10, 14) * 1000, null, 155.4, FROM)).toEqual({
      kind: 'close',
      exit: 155.4,
      time: at(10, 14),
      reason: 'manual',
    })
    expect(decideClose(jpy, at(10, 14) * 1000, null, undefined, FROM)).toEqual({ kind: 'wait' })
  })
})

describe('Close now: the request flow', () => {
  const race = () => {
    const st = createRaceState([{ id: 'ema50-pullback', name: 'EMA 50 pullback' }], 10_000, 0)
    const f = createFunded(0)
    const t: FundedTrade = { ...gbp, strategy: 'london-breakout' }
    st.funded = { ...f, open: [t] }
    st.strategies['ema50-pullback'].open = [
      { ...gbp, market: 'EUR-USD', entry: 1.15, stop: 1.14, takeProfit: 1.17 },
    ]
    st.prices = { 'GBP-USD': 1.302, 'EUR-USD': 1.151 }
    return st
  }
  const fundedId = tradeId(FUNDED_ACCOUNT, gbp)

  it('trade ids name the account, the market and the entry time', () => {
    const st = race()
    expect(fundedId).toBe(`funded|GBP-USD|${gbp.entryTime}`)
    expect(CLOSE_ID.test(fundedId)).toBe(true)
    const lab = tradeId('ema50-pullback', { market: 'EUR-USD', entryTime: gbp.entryTime })
    expect(CLOSE_ID.test(lab)).toBe(true)
    expect(findOpen(st, fundedId)?.trade.market).toBe('GBP-USD')
    expect(findOpen(st, lab)?.account).toBe('ema50-pullback')
    expect(findOpen(st, `funded|GBP-USD|${gbp.entryTime + 1}`)).toBeNull()
    expect(findOpen(st, `nobody|GBP-USD|${gbp.entryTime}`)).toBeNull()
    expect(CLOSE_ID.test('funded|GBP-USD|1; drop')).toBe(false)
  })

  it('a stored request is booked at the next check, both fees, then it can be cleared', () => {
    const st = race()
    const requests: CloseRequests = { [fundedId]: { id: fundedId, at: at(10, 14, 20) * 1000 } }
    const mins = quiet(at(10, 0), at(10, 20), 1.305)
    const r = bookCloseRequests(
      st,
      requests,
      () => mins,
      at(10, 0),
      () => 0.00007,
    )
    expect(r.booked.map((b) => [b.id, b.closed.reason, b.closed.exit])).toEqual([
      [fundedId, 'manual', 1.305],
    ])
    const f = r.state.funded!
    expect(f.open).toHaveLength(0)
    const pnl = 20_000 * 0.005 - 1.82 - 20_000 * 1.305 * 0.00007
    expect(f.closed[0].pnl).toBeCloseTo(pnl)
    expect(f.closed[0].strategy).toBe('london-breakout')
    expect(f.balance).toBeCloseTo(10_000 + pnl)
    // the Lab account is untouched
    expect(r.state.strategies['ema50-pullback'].open).toHaveLength(1)
    // asked again (the clear failed): the trade is gone, so the request is dropped
    const again = bookCloseRequests(
      r.state,
      requests,
      () => mins,
      at(10, 15),
      () => 0,
    )
    expect(again.dropped).toEqual([fundedId])
    expect(again.booked).toHaveLength(0)
  })

  it('a funded close names one size and closes the trade in that account only', () => {
    // The same v1 trade open in the $10K and the $50K (5x the units).
    const st = race()
    const t: FundedTrade = { ...gbp, strategy: 'london-breakout' }
    st.fundedSizes = [{ ...createFunded(0, [], 50_000), open: [{ ...t, units: 100_000 }] }]
    const id50 = tradeId(fundedAccountId(50_000), gbp)
    expect(id50).toBe(`funded-50k|GBP-USD|${gbp.entryTime}`)
    expect(CLOSE_ID.test(id50)).toBe(true)
    expect(findOpen(st, id50)?.trade.units).toBe(100_000)
    expect(findOpen(st, tradeId(fundedAccountId(100_000), gbp))).toBeNull() // not running
    const mins = quiet(at(10, 0), at(10, 20), 1.305)
    const r = bookCloseRequests(
      st,
      { [id50]: { id: id50, at: at(10, 14, 20) * 1000 } },
      () => mins,
      at(10, 0),
      () => 0,
    )
    expect(r.booked.map((b) => b.account)).toEqual(['funded-50k'])
    const fifty = r.state.fundedSizes![0]
    expect(fifty.open).toHaveLength(0)
    expect(fifty.balance).toBeCloseTo(50_000 + 100_000 * 0.005 - gbp.entryFee)
    // the $10K keeps its trade
    expect(r.state.funded?.open).toHaveLength(1)
    expect(r.state.funded?.balance).toBe(10_000)
  })

  it('a v1 + breakouts close names that test and size, and closes there only', () => {
    // The same trade open in v1 only $10K, v1 + breakouts $10K and v1 + breakouts $50K.
    const st = race()
    const t: FundedTrade = { ...gbp, strategy: 'johns-london-v1' }
    st.fundedB = [
      { ...createFunded(0), open: [t] },
      { ...createFunded(0, [], 50_000), open: [{ ...t, units: 100_000 }] },
    ]
    const idB = tradeId(fundedAccountId(10_000, 'breakouts'), gbp)
    expect(idB).toBe(`funded-b-10k|GBP-USD|${gbp.entryTime}`)
    expect(fundedAccountId(200_000, 'breakouts')).toBe('funded-b-200k')
    expect(CLOSE_ID.test(idB)).toBe(true)
    expect(findOpen(st, idB)?.trade).toMatchObject({ strategy: 'johns-london-v1', units: 20_000 })
    expect(findOpen(st, tradeId(fundedAccountId(100_000, 'breakouts'), gbp))).toBeNull()
    const mins = quiet(at(10, 0), at(10, 20), 1.305)
    const r = bookCloseRequests(
      st,
      { [idB]: { id: idB, at: at(10, 14, 20) * 1000 } },
      () => mins,
      at(10, 0),
      () => 0,
    )
    expect(r.booked.map((b) => b.account)).toEqual(['funded-b-10k'])
    const [tenB, fiftyB] = r.state.fundedB!
    expect(tenB.open).toHaveLength(0)
    expect(tenB.closed.map((c) => c.reason)).toEqual(['manual'])
    expect(tenB.balance).toBeCloseTo(10_000 + 20_000 * 0.005 - gbp.entryFee)
    // its other size and the v1 only test keep their trade
    expect(fiftyB.open).toHaveLength(1)
    expect(r.state.funded?.open).toHaveLength(1)
    expect(r.state.funded?.balance).toBe(10_000)
  })

  it('stop before the tap books the stop, not the tap', () => {
    const mins = quiet(at(10, 0), at(10, 20))
    mins[3] = min(at(10, 3), 1.291, 1.291, 1.289)
    const r = bookCloseRequests(
      race(),
      { [fundedId]: { id: fundedId, at: at(10, 10) * 1000 } },
      () => mins,
      at(10, 0),
      () => 0,
    )
    expect(r.booked[0].closed).toMatchObject({ reason: 'stop', exit: 1.29, exitTime: at(10, 3) })
  })

  it('unknown or closed trades are dropped, a failed 1-minute feed waits', () => {
    const lab = tradeId('ema50-pullback', { market: 'EUR-USD', entryTime: gbp.entryTime })
    const gone = `ema50-pullback|GBP-USD|${gbp.entryTime}`
    const r = bookCloseRequests(
      race(),
      {
        [gone]: { id: gone, at: at(10, 1) * 1000 },
        [lab]: { id: lab, at: at(10, 2) * 1000 },
      },
      () => undefined,
      at(10, 0),
      () => 0,
    )
    expect(r.dropped).toEqual([gone])
    expect(r.waiting).toEqual([lab])
    expect(r.state.strategies['ema50-pullback'].open).toHaveLength(1)
  })
})

/** A fake KV namespace and the worker's secrets. */
const kvEnv = () => {
  const store = new Map<string, string>()
  return {
    store,
    env: {
      READ_KEY: 'site-key',
      WRITE_KEY: 'mac-key',
      RACE: {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => void store.set(k, v),
      },
    },
  }
}
const call = (env: unknown, method: string, key: string | null, body?: unknown) =>
  worker.fetch(
    new Request('https://relay.test/close-requests', {
      method,
      headers: {
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  )

describe('relay worker: /close-requests', () => {
  const id = `funded|GBP-USD|${gbp.entryTime}`

  it('the site stores a request; a second tap keeps the first time', async () => {
    const { env } = kvEnv()
    const first = await (await call(env, 'POST', 'site-key', { id })).json()
    expect(first.duplicate).toBe(false)
    expect(first.request.id).toBe(id)
    const second = await (await call(env, 'POST', 'site-key', { id })).json()
    expect(second).toEqual({ request: first.request, duplicate: true })
    const all = await (await call(env, 'GET', 'mac-key')).json()
    expect(Object.keys(all)).toEqual([id])
  })

  it('only the Mac clears; no key, a bad key or a bad id is refused', async () => {
    const { env } = kvEnv()
    await call(env, 'POST', 'site-key', { id })
    expect((await call(env, 'DELETE', 'site-key', { ids: [id] })).status).toBe(401)
    expect((await call(env, 'GET', null)).status).toBe(401)
    expect((await call(env, 'POST', 'guess', { id })).status).toBe(401)
    expect((await call(env, 'POST', 'site-key', { id: 'funded|x|1; drop' })).status).toBe(400)
    const del = await call(env, 'DELETE', 'mac-key', { ids: [id, 'funded|EUR-USD|1'] })
    expect(await del.json()).toEqual({ removed: 1 })
    expect(await (await call(env, 'GET', 'site-key')).json()).toEqual({})
  })

  it('the race state endpoint still works as before', async () => {
    const { env, store } = kvEnv()
    const put = await worker.fetch(
      new Request('https://relay.test/race', {
        method: 'PUT',
        headers: { authorization: 'Bearer mac-key' },
        body: JSON.stringify({ version: 1, strategies: {} }),
      }),
      env,
    )
    expect(put.status).toBe(200)
    expect(store.get('state')).toContain('"version":1')
  })
})
