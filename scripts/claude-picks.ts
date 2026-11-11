/**
 * Claude's picks: one more race account where Claude chooses the trades.
 *
 *   npx tsx scripts/claude-picks.ts            (weekdays 03:47 AST via launchd, docs/london-open.md)
 *   npx tsx scripts/claude-picks.ts --dry-run  (print the brief and the decision, save nothing)
 *   npx tsx scripts/claude-picks.ts --no-push  (save to RACE_FILE but do not send to the live site)
 *
 * 1. Builds a short brief per market (GBP/USD, gold): the last 12h of 15m
 *    candles, the Asian range, 1h EMA50/EMA200 trend, RSI14, ATR14 on 15m and
 *    1h, the stop distances allowed, nearest swing highs/lows, the price now
 *    and open race trades.
 * 2. Asks a locked-down `claude -p` (John's subscription, never the API; no
 *    tools, no MCP, no settings, an empty folder, 5 minutes max) for JSON:
 *    up to 2 trades with stop, target and a short reason, or none.
 * 3. Checks every trade hard in code (src/lib/race/claudePicks.ts) and opens
 *    the ones that pass at the current price, 2% risk, same limits as the race.
 *    Saves race.json under the race lock and pushes it like a tick.
 * If Claude fails or answers junk, it logs that and does nothing.
 * Play money only: nothing here talks to a broker.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getInstrument, type PriceMap } from '../src/lib/paper/instruments'
import { FEE_RATE, LEVERAGE } from '../src/lib/paper/engine'
import { sizingLine, sizingOf, usdPerQuoteFor } from '../src/lib/sizing/sizing'
import { londonBreakout } from '../src/lib/race/londonBreakout'
import {
  atr1h,
  CLAUDE_PICKS,
  checkPicks,
  marketBrief,
  parsePicks,
  picksPrompt,
  stopBand,
  type MarketData,
} from '../src/lib/race/claudePicks'
import { minStopForFullRisk, RACE_SIZING } from '../src/lib/race/account'
import { BST_NOTE, londonOnSummerTime } from '../src/lib/positions/london'
import { stepStrategy, syncRaceState, type MarketTick } from '../src/lib/race/live'
import { clearKrakenCache } from '../src/lib/kraken'
import { fetchMarket, FILE, load, push, save, waitLock } from './race-io'

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const stamp = () => new Date().toISOString()

// One fixed folder, emptied before each run: claude keeps a ~/.claude/projects
// entry per working folder, so a new temp folder each day would leave one each.
const CWD = join(homedir(), '.local/share/trade-hub/claude-picks-cwd')

/** Locked-down claude: no tools, no MCP, no settings or slash commands, bare env, empty folder. */
function askClaude(prompt: string): string {
  const dir = CWD
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  try {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      HOME: homedir(),
      LANG: 'en_US.UTF-8',
    }
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN)
      env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN
    const p = spawnSync(
      'claude',
      [
        '-p',
        // Model and effort per job (docs: ~/.claude/skills/model-routing).
        '--model',
        process.env.CLAUDE_PICKS_MODEL ?? 'opus',
        '--effort',
        process.env.CLAUDE_PICKS_EFFORT ?? 'medium',
        '--output-format',
        'json',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        JSON.stringify({ mcpServers: {} }),
        '--disable-slash-commands',
        '--tools',
        '',
        '--no-session-persistence',
      ],
      {
        input: prompt,
        cwd: dir,
        encoding: 'utf8',
        timeout: 5 * 60_000,
        env: env as unknown as NodeJS.ProcessEnv,
      },
    )
    if (p.error) throw new Error(`claude did not run: ${p.error.message}`)
    if (p.status !== 0)
      throw new Error(`claude exited ${p.status}: ${(p.stderr || p.stdout).slice(0, 300)}`)
    const out = JSON.parse(p.stdout) as { result?: unknown; is_error?: boolean }
    if (out.is_error) throw new Error(`claude error: ${String(out.result).slice(0, 300)}`)
    return String(out.result ?? '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main() {
  const nowSec = Math.floor(Date.now() / 1000)
  if (londonOnSummerTime(nowSec * 1000)) console.log(`${stamp()} ${BST_NOTE}`)
  const before = load()
  if (!before && !DRY) throw new Error(`no race file at ${FILE}; run a race tick first`)
  const riskPct = before?.sizing.riskPct ?? RACE_SIZING.riskPct
  /** Stop distances allowed at this price (1h ATR band, margin floor). */
  const bandAt = (id: string, price: number, a1h: number) =>
    stopBand(a1h, minStopForFullRisk(price, LEVERAGE[getInstrument(id)!.market], riskPct))

  // ── Data and brief (no lock needed: nothing is written yet) ──
  const markets: MarketData[] = []
  const prices: PriceMap = { ...(before?.prices ?? {}) }
  const atr: Record<string, number> = {}
  const band: Record<string, { min: number; max: number }> = {}
  for (const id of CLAUDE_PICKS.markets) {
    try {
      const m15 = await fetchMarket(id, '15m')
      const h1 = await fetchMarket(id, '1h')
      const price = m15.at(-1)!.close
      prices[id] = price
      atr[id] = atr1h(h1)
      band[id] = bandAt(id, price, atr[id])
      const open = Object.values(before?.strategies ?? {}).flatMap((s) =>
        s.open.filter((t) => t.market === id).map((trade) => ({ by: s.name, trade })),
      )
      const london = londonBreakout(m15, h1, nowSec, {
        price,
        minDist: minStopForFullRisk(price, LEVERAGE[getInstrument(id)!.market], riskPct),
      })
      markets.push({ market: id, m15, h1, price, london, open, band: band[id] })
    } catch (e) {
      console.log(`${stamp()} ${id} left out: ${(e as Error).message}`)
    }
  }
  if (!markets.length) {
    console.log(`${stamp()} no market data; no picks today`)
    return
  }
  const briefs = markets.map((m) => marketBrief(m, nowSec))
  console.log(`${stamp()} Claude's picks: brief\n\n${briefs.join('\n\n')}\n`)

  // ── Ask Claude ──
  let answer: string
  try {
    const balance = before?.strategies[CLAUDE_PICKS.id]?.balance ?? before?.startMoney
    answer = askClaude(picksPrompt(briefs, nowSec, balance))
  } catch (e) {
    console.log(`${stamp()} Claude failed, no picks today: ${(e as Error).message}`)
    return
  }
  console.log(`Claude answered: ${answer.trim().slice(0, 1500)}`)
  const parsed = parsePicks(answer)
  if (!parsed.ok) {
    console.log(`${stamp()} answer was junk (${parsed.error}); no picks today`)
    return
  }

  const ctx = (open = before?.strategies[CLAUDE_PICKS.id]?.open ?? []) => ({
    prices,
    band,
    open,
  })
  const first = checkPicks(parsed.raw, ctx())
  for (const r of first.rejected) console.log(`  REJECT ${JSON.stringify(r.raw)}: ${r.reason}`)
  for (const p of first.accepted)
    console.log(
      `  OK     ${p.market} ${p.direction} stop ${p.stop} target ${p.target}: ${p.reason}`,
    )
  if (DRY) {
    console.log(
      `Dry run: nothing saved. ${first.accepted.length} pick(s) would open at the current price.`,
    )
    return
  }
  if (!first.accepted.length) {
    console.log(`${stamp()} no picks today`)
    return
  }

  // ── Open under the race lock, on the freshest state ──
  const release = await waitLock(5 * 60_000)
  if (!release) {
    console.log(`${stamp()} the race stayed busy for 5 minutes; picks not opened`)
    return
  }
  try {
    const synced = syncRaceState(load()!, [{ id: CLAUDE_PICKS.id, name: CLAUDE_PICKS.name }])
    const state = synced.state
    for (const c of synced.changes) console.log(`  ${c}`)
    const own = state.strategies[CLAUDE_PICKS.id]
    // Fresh prices: Claude took a while, and trades open at the price now.
    clearKrakenCache()
    for (const m of markets) {
      try {
        m.m15 = await fetchMarket(m.market, '15m')
        m.price = m.m15.at(-1)!.close
        prices[m.market] = m.price
        band[m.market] = bandAt(m.market, m.price, atr[m.market])
      } catch (e) {
        console.log(`  ${m.market}: no fresh price (${(e as Error).message}), using the brief's`)
      }
    }
    // Checked again: the price moved, and a tick may have changed the open picks.
    const { accepted, rejected } = checkPicks(parsed.raw, ctx(own.open))
    for (const r of rejected)
      if (!first.rejected.some((x) => x.raw === r.raw))
        console.log(`  REJECT at the fresh price ${JSON.stringify(r.raw)}: ${r.reason}`)
    const byMarket = new Map(accepted.map((p) => [p.market, p]))
    const ticks: MarketTick[] = markets.map((m) => {
      const inst = getInstrument(m.market)!
      const pick = byMarket.get(m.market)
      return {
        market: m.market,
        signal: pick
          ? {
              index: 0,
              time: nowSec,
              direction: pick.direction,
              entry: m.price,
              stop: pick.stop,
              takeProfit: pick.target,
            }
          : null,
        path: m.m15,
        price: m.price,
        usdPerQuote: usdPerQuoteFor(inst, m.price, prices),
        feeRate: FEE_RATE[inst.market],
        leverage: LEVERAGE[inst.market],
        note: pick?.reason,
      }
    })
    const r = stepStrategy(own, ticks, nowSec, state.sizing)
    state.strategies[CLAUDE_PICKS.id] = r.strategy
    state.prices = {
      ...state.prices,
      ...Object.fromEntries(markets.map((m) => [m.market, m.price])),
    }
    save(state)
    for (const t of r.opened) {
      const inst = getInstrument(t.market)
      console.log(
        `  OPEN  ${CLAUDE_PICKS.name} ${t.market} ${t.direction} at ${t.entry}: ${sizingLine(inst, sizingOf({ inst, ...t, target: t.takeProfit }))}`,
      )
    }
    for (const c of r.closed) console.log(`  CLOSE ${CLAUDE_PICKS.name} ${c.market} ${c.reason}`)
    for (const x of r.passed) console.log(`  PASS  ${CLAUDE_PICKS.name} ${x.market}: ${x.reason}`)
    console.log(`${stamp()} saved ${FILE}: ${r.opened.length} pick(s) opened (play money only)`)
    if (args.includes('--no-push')) console.log('Not pushed (--no-push)')
    else await push(state)
  } finally {
    release()
  }
}

main().catch((e) => {
  console.error(`claude picks failed: ${(e as Error).message}`)
  process.exit(1)
})
