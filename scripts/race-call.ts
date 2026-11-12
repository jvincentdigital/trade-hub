/**
 * John's calls (John, 2026-11-12): record a trade John called by chat, as
 * limit orders in his own $10,000 race account (src/lib/race/johnsCalls.ts).
 * The race tick fills and manages them on Kraken's 1-minute candles after
 * the call. Play money only: nothing here talks to a broker.
 *
 *   make race-call MARKET=pax-gold SIDE=long ENTRIES=3905,3895,3885 STOP=3855 \
 *     TARGETS=4134,4200 [RISK=2] [SPLIT=50,50] [NOTE="..."] [EXPIRES=72]
 *   make race-call-cancel ID=1   (cancel its waiting orders; filled trades keep running)
 *   make race-call-list
 *
 * The values come from the environment (make passes its command line on), so
 * a NOTE with quotes or apostrophes is safe. RISK is the % of the balance lost
 * if every entry fills and the stop is hit, shared evenly over the entries;
 * SPLIT is the % of each entry closed at each target (default half at the
 * first, the rest at the last); EXPIRES is hours until waiting orders cancel.
 * Takes the race lock, saves race.json, then pushes to the live site like the
 * tick (RACE_FILE set, or --no-push: never pushed).
 */
import { formatQuote, getInstrument } from '../src/lib/paper/instruments'
import { sizeText, sizingOf, usdPerQuoteFor } from '../src/lib/sizing/sizing'
import {
  cancelCall,
  JOHNS_CALLS,
  planCall,
  withJohnsCalls,
  type CallInput,
} from '../src/lib/race/johnsCalls'
import type { Call } from '../src/lib/race/callSchema'
import type { RaceState } from '../src/lib/race/live'
import { FILE, load, push, save, waitLock } from './race-io'

const args = process.argv.slice(2)
const flag = (name: string) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? '') : null)

const ast = (sec: number) =>
  new Date(sec * 1000).toLocaleString('en-US', {
    timeZone: 'America/Puerto_Rico',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }) + ' AST'

/** One call in plain words, every order on its own line. */
function describe(c: Call, state: RaceState): string[] {
  const inst = getInstrument(c.market)
  const q = usdPerQuoteFor(inst, state.prices[c.market] ?? 0, state.prices) ?? 1
  const px = (p: number) => formatQuote(p, inst)
  const side = c.direction === 'long' ? 'BUY' : 'SELL'
  const split = c.targets.map((t, i) => `${px(t)} (${+c.split[i].toFixed(2)}%)`).join(', ')
  const lines = [
    `#${c.id} ${side} ${inst?.label ?? inst?.symbol ?? c.market}, ${c.riskPct}% risk, made ${ast(c.madeAt)}, waiting orders cancel ${ast(c.expiresAt)}`,
    `   stop ${px(c.stop)} for every entry; targets ${split}`,
  ]
  for (const o of c.orders) {
    const s = sizingOf({ inst, units: o.units, entry: o.entry, stop: c.stop, usdPerQuote: q })
    const leg = (units: number) =>
      sizeText(inst, sizingOf({ inst, units, entry: o.entry, usdPerQuote: q }))
    const at = c.targets
      .flatMap((t, i) => (o.legs[i] > 0 ? [`${leg(o.legs[i])} at ${px(t)}`] : []))
      .join(', ')
    const status =
      o.status === 'filled'
        ? `filled at ${px(o.fill!)} ${ast(o.at!)}`
        : o.status === 'cancelled'
          ? `cancelled ${ast(o.at!)} (${o.why})`
          : 'waiting'
    lines.push(
      `   ${side} limit ${px(o.entry)}: ${sizeText(inst, s)}, risk $${s.riskUsd?.toFixed(2)} at the stop; closes ${at}; ${status}`,
    )
  }
  if (c.note) lines.push(`   note: ${c.note}`)
  return lines
}

async function main() {
  if (args.includes('--list')) {
    const state = load()
    const calls = state?.calls ?? []
    if (!state || !calls.length) {
      console.log('No calls yet.')
      return
    }
    const account = state.strategies[JOHNS_CALLS.id]
    for (const c of calls) console.log(describe(c, state).join('\n'))
    if (account)
      console.log(
        `${JOHNS_CALLS.name}: balance $${account.balance.toFixed(2)}, ${account.open.length} open, ${account.closed.length} closed`,
      )
    return
  }

  const release = await waitLock(3 * 60_000)
  if (!release) throw new Error('another race run is still going; try again in a minute')
  try {
    const loaded = load()
    if (!loaded) throw new Error(`no race file at ${FILE}; run make race-tick first`)
    const state = withJohnsCalls(loaded).state
    const nowSec = Math.floor(Date.now() / 1000)
    const cancelId = flag('--cancel')
    let next: RaceState
    if (cancelId !== null) {
      const r = cancelCall(state.calls ?? [], cancelId.trim(), nowSec)
      if (!r.ok) throw new Error(r.error)
      next = { ...state, calls: r.calls }
      console.log(
        `Call #${cancelId}: ${r.cancelled} waiting order(s) cancelled; filled trades keep running`,
      )
    } else {
      const env = process.env
      const input: CallInput = {
        market: env.MARKET,
        side: env.SIDE,
        entries: env.ENTRIES,
        stop: env.STOP,
        targets: env.TARGETS,
        risk: env.RISK,
        split: env.SPLIT,
        note: env.NOTE,
        expires: env.EXPIRES,
      }
      const r = planCall(input, state, nowSec)
      if (!r.ok) {
        for (const e of r.errors) console.log(`  ${e}`)
        throw new Error('call not saved')
      }
      next = { ...state, calls: [...(state.calls ?? []), r.call] }
      console.log(`Call saved (play money, ${JOHNS_CALLS.name}):`)
      console.log(describe(r.call, next).join('\n'))
      console.log(
        `   the race price now is ${formatQuote(state.prices[r.call.market], getInstrument(r.call.market))}; orders fill from the next race check, on prices after ${ast(r.call.madeAt)}`,
      )
    }
    save(next)
    console.log(`Saved ${FILE}`)
    if (args.includes('--no-push')) console.log('Not pushed (--no-push)')
    else await push(next)
  } finally {
    release()
  }
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
