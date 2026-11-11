/**
 * Close every open race trade by hand, the funded test's too (John, 2026-11-11: "close all the
 * trades and take the profit"). Each trade closes at the open of the first
 * 1-minute Kraken candle at or after --at (the minute after he asked, so no
 * hindsight). Markets the race prices from daily ECB rates (USD/JPY, NZD/USD)
 * close at the race's own last price; GBP/JPY at GBP/USD times the race's
 * USD/JPY leg, as the race computes it. Both fees are booked, reason 'manual'
 * ("closed by you" on the Race page).
 *
 * Safety: takes the race lock, and stops without saving if any open trade
 * touched its stop or target between the last race check and the fill minute
 * (that close would have come first).
 *
 *   npx tsx scripts/race-close-all.ts --at 2026-11-11T17:04:31Z [--dry-run]
 */
import { FEE_RATE } from '../src/lib/paper/engine'
import { getInstrument } from '../src/lib/paper/instruments'
import { KRAKEN_PAIRS } from '../src/lib/kraken'
import { closeAll } from '../src/lib/race/live'
import { FUNDED } from '../src/lib/race/funded'
import type { Minute } from '../src/lib/race/closeRequests'
import { fetchMinutes, load, money, push, save, waitLock, FILE } from './race-io'

const args = process.argv.slice(2)
const atIdx = args.indexOf('--at')
const atMs = atIdx >= 0 ? Date.parse(args[atIdx + 1] ?? '') : NaN
const dry = args.includes('--dry-run')

async function main() {
  if (!(atMs > 0)) throw new Error('usage: race-close-all.ts --at <ISO time> [--dry-run]')
  const fillSec = Math.ceil(atMs / 60_000) * 60
  const release = await waitLock(3 * 60_000)
  if (!release) throw new Error('another race run is still going; try again in a minute')
  try {
    const state = load()
    if (!state) throw new Error(`no race file at ${FILE}`)
    const lastCheck = state.ticks.at(-1)?.at ?? 0
    // The last check saw candles closed before it ran: from that quarter hour on is unchecked.
    const fromSec = Math.floor(lastCheck / 1000 / 900) * 900
    const open = [
      ...Object.values(state.strategies).flatMap((s) =>
        s.open.map((t) => ({ ...t, strategy: s.name })),
      ),
      ...(state.funded?.open ?? []).map((t) => ({ ...t, strategy: FUNDED.name })),
    ]
    const markets = [...new Set(open.map((t) => t.market))]
    const pairOf = (m: string) => KRAKEN_PAIRS[m === 'GBP-JPY' ? 'GBP-USD' : m]
    const rows = new Map<string, Minute[]>()
    for (const pair of new Set(markets.map(pairOf).filter(Boolean))) {
      rows.set(pair, await fetchMinutes(pair, fromSec))
      await new Promise((r) => setTimeout(r, 1100))
    }

    const prices: Record<string, number> = {}
    for (const m of markets) {
      const pair = pairOf(m)
      if (!pair) {
        prices[m] = state.prices[m] // daily ECB rate, the race's own price
        console.log(`  ${m}: race price ${prices[m]} (daily rate, no 1-minute candles)`)
        continue
      }
      const fill = rows.get(pair)!.find((r) => r.t >= fillSec)
      if (!fill) throw new Error(`no ${pair} 1-minute candle at or after the fill minute yet`)
      const leg = m === 'GBP-JPY' ? state.prices['GBP-JPY'] / state.prices['GBP-USD'] : 1
      prices[m] = fill.o * leg
      const at = new Date(fill.t * 1000).toISOString().slice(11, 16)
      console.log(`  ${m}: ${prices[m]} (open of the ${at} UTC minute)`)
    }

    // A stop or target touched before the fill minute would have closed first.
    const touched = open.filter((t) => {
      const r = rows.get(pairOf(t.market) ?? '')
      if (!r || t.market === 'GBP-JPY') return false
      return r
        .filter((x) => x.t >= fromSec && x.t < fillSec)
        .some((x) => x.l <= Math.min(t.stop, t.takeProfit) || x.h >= Math.max(t.stop, t.takeProfit))
    })
    if (touched.length) {
      for (const t of touched)
        console.log(`  STOP  ${t.strategy} ${t.market} touched its stop or target before the fill`)
      throw new Error('not saved: close those by hand first')
    }

    const feeRate = (m: string) => FEE_RATE[getInstrument(m)?.market ?? 'forex']
    const r = closeAll(state, prices, fillSec, feeRate)
    for (const c of r.closed)
      console.log(`  CLOSE ${c.strategy} ${c.market} ${c.direction} at ${c.exit}: ${money(c.pnl)}`)
    const net = r.closed.reduce((a, c) => a + c.pnl, 0)
    console.log(`${r.closed.length} trades closed by hand, ${money(net)} after fees`)
    if (r.missing.length) console.log(`  still open (no price): ${r.missing.join(', ')}`)
    if (dry) {
      console.log('dry run: nothing saved')
      return
    }
    save(r.state)
    await push(r.state)
  } finally {
    release()
  }
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
