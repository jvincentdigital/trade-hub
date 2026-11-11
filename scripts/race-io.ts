/**
 * Shared by scripts/race-tick.ts and scripts/claude-picks.ts: where the race
 * file lives, reading and writing it, pushing it to the live site, the lock
 * that keeps two runs from writing at once, and fetching candles politely.
 * Play money only: nothing here talks to a broker.
 */
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseRaceState, type RaceState } from '../src/lib/race/live'
import { feedOf } from '../src/lib/feeds'
import { fetchMarketCandles } from '../src/lib/race/feeds'
import type { CandleTf } from '../src/lib/kraken'
import type { OHLCCandle } from '../src/lib/types/market'

export const FILE = process.env.RACE_FILE || join(homedir(), '.local/share/trade-hub/race.json')
const ENV_FILE = join(homedir(), '.local/share/trade-hub/race.env')
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const money = (n: number) => `${n < -0.005 ? '-' : '+'}$${Math.abs(n).toFixed(2)}`

export function load(): RaceState | null {
  if (!existsSync(FILE)) return null
  const parsed = parseRaceState(JSON.parse(readFileSync(FILE, 'utf8')))
  if (!parsed.ok) throw new Error(`${FILE} is not a valid race file; fix it or run make race-reset`)
  if (parsed.migrated) {
    // Old layout (money split per market): keep a copy before the first save in the new one.
    const bak = `${FILE}.bak-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-split`
    copyFileSync(FILE, bak)
    console.log(`Moved the race to one account per strategy (old file kept at ${bak})`)
  }
  return parsed.state
}

export function save(state: RaceState) {
  mkdirSync(dirname(FILE), { recursive: true })
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 1))
  renameSync(tmp, FILE)
}

/** Send the saved state to the live site's relay. Never throws, never prints the key. */
export async function push(state: RaceState) {
  if (!existsSync(ENV_FILE)) return
  const env = Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
  if (!env.RACE_PUT_URL || !env.RACE_WRITE_KEY) return
  try {
    const res = await fetch(env.RACE_PUT_URL, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${env.RACE_WRITE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(state),
      signal: AbortSignal.timeout(20_000),
    })
    console.log(
      res.ok ? 'Pushed to the live site' : `Push to the live site failed: HTTP ${res.status}`,
    )
  } catch (e) {
    console.log(`Push to the live site failed: ${(e as Error).message}`)
  }
}

// ── Lock: one writer at a time ───────────────────────────────────────────
// race.json.lock holds "<pid> <ms>". A lock whose process is gone, or older
// than 20 minutes, is stale and taken over.

const LOCK = `${FILE}.lock`
const STALE_MS = 20 * 60_000

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Take the lock, or null when another run holds it. The returned function lets it go. */
export function tryLock(): (() => void) | null {
  mkdirSync(dirname(LOCK), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK, 'wx')
      const mine = `${process.pid} ${Date.now()}`
      writeSync(fd, mine)
      closeSync(fd)
      let done = false
      const release = () => {
        if (done) return
        done = true
        try {
          if (readFileSync(LOCK, 'utf8') === mine) unlinkSync(LOCK)
        } catch {
          // already gone
        }
      }
      process.once('exit', release)
      return release
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      const [pid, at] = readFileSync(LOCK, 'utf8').split(' ').map(Number)
      if (alive(pid) && Date.now() - at < STALE_MS) return null
      unlinkSync(LOCK) // stale: its run died or hung; take it over
    }
  }
  return null
}

/** Wait up to `ms` for the lock (Claude's picks waits for a running tick). */
export async function waitLock(ms: number): Promise<(() => void) | null> {
  const until = Date.now() + ms
  for (;;) {
    const release = tryLock()
    if (release || Date.now() > until) return release
    await sleep(5000)
  }
}

// ── Candles ──────────────────────────────────────────────────────────────

/** Any market, any size (ECB-only forex is always daily). ECB gets one polite retry; Kraken retries itself. */
export async function fetchMarket(id: string, tf: CandleTf): Promise<OHLCCandle[]> {
  if (feedOf(id) !== 'ecb') return fetchMarketCandles(id, tf)
  try {
    return await fetchMarketCandles(id, tf)
  } catch {
    await sleep(30_000)
    return fetchMarketCandles(id, tf)
  }
}
