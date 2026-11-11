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
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseRaceState, type RaceState } from '../src/lib/race/live'
import { feedOf } from '../src/lib/feeds'
import { fetchMarketCandles, fetchYahooHourly, YAHOO_US30 } from '../src/lib/race/feeds'
import { FF_WEEK_URL, parseFfWeek } from '../src/lib/race/newsFeed'
import type { NewsEvent } from '../src/lib/lab/news'
import { dropClosedForex } from '../src/lib/race/candles'
import { getInstrument } from '../src/lib/paper/instruments'
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
// than 20 minutes (a hung run), is stale and taken over. Taking over is
// guarded by a second file (race.json.lock.takeover, created exclusively), so
// two runs that both see the same stale lock cannot both end up holding it.

const LOCK = `${FILE}.lock`
const TAKEOVER = `${LOCK}.takeover`
const STALE_MS = 20 * 60_000
const code = (e: unknown) => (e as NodeJS.ErrnoException).code

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return code(e) === 'EPERM'
  }
}

const readLock = (): string | null => {
  try {
    return readFileSync(LOCK, 'utf8')
  } catch (e) {
    if (code(e) === 'ENOENT') return null
    throw e
  }
}

function isStale(content: string): boolean {
  const [pid, at] = content.split(' ').map(Number)
  return !(pid > 0 && at > 0 && alive(pid) && Date.now() - at < STALE_MS)
}

/** Remove the lock if it is (still) the stale one. True when the way is clear. */
function clearStale(): boolean {
  const seen = readLock()
  if (seen === null) return true // let go meanwhile: try again
  if (!isStale(seen)) return false
  let fd: number
  try {
    fd = openSync(TAKEOVER, 'wx')
  } catch (e) {
    if (code(e) !== 'EEXIST') throw e
    // Another run is taking it over. A takeover file left by a killed run
    // (older than a minute) is removed; this run still counts as busy.
    try {
      if (Date.now() - statSync(TAKEOVER).mtimeMs > 60_000) unlinkSync(TAKEOVER)
    } catch {
      // gone already
    }
    return false
  }
  try {
    const now = readLock()
    if (now !== seen) return now === null // someone else took it: busy
    try {
      unlinkSync(LOCK)
    } catch (e) {
      if (code(e) !== 'ENOENT') throw e
    }
    return true
  } finally {
    closeSync(fd)
    try {
      unlinkSync(TAKEOVER)
    } catch {
      // gone already
    }
  }
}

/** Take the lock, or null when another run holds it. The returned function lets it go. */
export function tryLock(): (() => void) | null {
  mkdirSync(dirname(LOCK), { recursive: true })
  const mine = `${process.pid} ${Date.now()}`
  // Written first, then hard-linked into place: the lock never exists empty.
  const tmp = `${LOCK}.${process.pid}`
  writeFileSync(tmp, mine)
  let got = false
  try {
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      try {
        linkSync(tmp, LOCK)
        got = true
      } catch (e) {
        if (code(e) !== 'EEXIST') throw e
        if (!clearStale()) return null
      }
    }
  } finally {
    unlinkSync(tmp)
  }
  if (!got) return null
  let done = false
  const release = () => {
    if (done) return
    done = true
    try {
      if (readLock() === mine) unlinkSync(LOCK)
    } catch {
      // already gone
    }
  }
  process.once('exit', release)
  // Ctrl-C on make race-tick, or launchd stopping a job, must not leave a lock behind.
  for (const [sig, n] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)
    process.once(sig, () => {
      release()
      process.exit(n)
    })
  return release
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

/**
 * Any market, any size (ECB-only forex is always daily). ECB gets one polite
 * retry; Kraken retries itself. Forex candles that start while the real market
 * is shut (Friday 17:00 to Sunday 17:00 New York) are left out: Kraken prints
 * them, but no broker would fill there.
 */
export async function fetchMarket(id: string, tf: CandleTf): Promise<OHLCCandle[]> {
  // US30 (lab bots only): Dow futures 1h from Yahoo's public chart feed, whatever size is asked.
  if (id === 'US30') return fetchYahooHourly(YAHOO_US30)
  const forex = getInstrument(id)?.market === 'forex'
  const get = () => fetchMarketCandles(id, tf).then((c) => (forex ? dropClosedForex(c) : c))
  if (feedOf(id) !== 'ecb') return get()
  try {
    return await get()
  } catch {
    await sleep(30_000)
    return get()
  }
}

// ── Red news (lab bots' news filter) ─────────────────────────────────────

const FF_CACHE = join(dirname(FILE), 'ff-thisweek.json')
const FF_MAX_AGE_MS = 6 * 3600_000

/**
 * This week's red ("High") events from Forex Factory's free weekly feed. The
 * file is cached next to the race file and downloaded at most every 6 hours
 * (about 4 calls a day). A failed download falls back to the cached copy;
 * with neither, the lab bots' news filter is off for that tick and says so.
 */
export async function loadRedNews(): Promise<{ events: NewsEvent[]; note: string }> {
  const cached = existsSync(FF_CACHE) ? statSync(FF_CACHE) : null
  if (cached && Date.now() - cached.mtimeMs < FF_MAX_AGE_MS) {
    const events = parseFfWeek(JSON.parse(readFileSync(FF_CACHE, 'utf8')))
    return { events, note: `red news: ${events.length} events this week (cached)` }
  }
  try {
    const res = await fetch(FF_WEEK_URL, {
      headers: { 'user-agent': 'trade-hub race (play money)' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json: unknown = await res.json()
    const events = parseFfWeek(json)
    if (!Array.isArray(json)) throw new Error('not a list')
    writeFileSync(`${FF_CACHE}.tmp`, JSON.stringify(json))
    renameSync(`${FF_CACHE}.tmp`, FF_CACHE)
    return { events, note: `red news: ${events.length} events this week (Forex Factory)` }
  } catch (e) {
    if (cached) {
      const events = parseFfWeek(JSON.parse(readFileSync(FF_CACHE, 'utf8')))
      return {
        events,
        note: `red news: feed failed (${(e as Error).message}), using the cached copy`,
      }
    }
    return {
      events: [],
      note: `red news: feed failed (${(e as Error).message}), news filter off this tick`,
    }
  }
}
