/**
 * Shared by scripts/race-tick.ts and scripts/claude-picks.ts: where the race
 * file lives, reading and writing it, pushing it to the live site, the Close
 * now requests, the lock that keeps two runs from writing at once, and
 * fetching candles politely.
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
import { closeRequestsSchema, type CloseRequests, type Minute } from '../src/lib/race/closeRequests'
import { feedOf } from '../src/lib/feeds'
import { fetchMarketCandles } from '../src/lib/race/feeds'
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

/** RACE_PUT_URL and RACE_WRITE_KEY from race.env, or null. Never printed. */
function relayEnv(): { url: string; key: string } | null {
  if (!existsSync(ENV_FILE)) return null
  const env = Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
  return env.RACE_PUT_URL && env.RACE_WRITE_KEY
    ? { url: env.RACE_PUT_URL, key: env.RACE_WRITE_KEY }
    : null
}

/** Send the saved state to the live site's relay. Never throws, never prints the key. */
export async function push(state: RaceState) {
  const env = relayEnv()
  if (!env) return
  try {
    const res = await fetch(env.url, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${env.key}`,
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

// ── Close now requests (docs/live.md) ────────────────────────────────────
// The live site stores taps in the relay worker; the Mac's race check books
// them. A test run (RACE_FILE set) uses a local file instead, so it can
// never book or clear John's real requests.

export const CLOSE_FILE = process.env.RACE_CLOSE_FILE || join(dirname(FILE), 'close-requests.json')
const closeRelay = () => {
  const env = process.env.RACE_FILE ? null : relayEnv()
  return env && { url: new URL('/close-requests', env.url).toString(), key: env.key }
}

/** Pending requests by trade id; {} when there are none or the relay can't be read. */
export async function loadCloseRequests(): Promise<CloseRequests> {
  const relay = closeRelay()
  try {
    const raw = relay
      ? await fetch(relay.url, {
          headers: { authorization: `Bearer ${relay.key}` },
          signal: AbortSignal.timeout(20_000),
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
      : existsSync(CLOSE_FILE)
        ? JSON.parse(readFileSync(CLOSE_FILE, 'utf8'))
        : {}
    const parsed = closeRequestsSchema.safeParse(raw)
    if (!parsed.success) throw new Error('not a list of close requests')
    return parsed.data
  } catch (e) {
    console.log(`  Close requests not read: ${(e as Error).message}`)
    return {}
  }
}

/** Remove booked or dropped requests. Never throws; a request left over is dropped next check. */
export async function clearCloseRequests(ids: string[]) {
  if (!ids.length) return
  const relay = closeRelay()
  try {
    if (relay) {
      const res = await fetch(relay.url, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${relay.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } else if (existsSync(CLOSE_FILE)) {
      const all = JSON.parse(readFileSync(CLOSE_FILE, 'utf8')) as Record<string, unknown>
      for (const id of ids) delete all[id]
      writeFileSync(`${CLOSE_FILE}.tmp`, JSON.stringify(all))
      renameSync(`${CLOSE_FILE}.tmp`, CLOSE_FILE)
    }
  } catch (e) {
    console.log(`  Close requests not cleared: ${(e as Error).message}`)
  }
}

/** Kraken 1-minute candles since `sinceSec` (the last 720 minutes at most), oldest first. */
export async function fetchMinutes(pair: string, sinceSec: number): Promise<Minute[]> {
  const res = await fetch(
    `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1&since=${sinceSec - 60}`,
    { signal: AbortSignal.timeout(20_000) },
  )
  const j = (await res.json()) as { error?: string[]; result?: Record<string, unknown> }
  if (j.error?.length || !j.result) throw new Error(`Kraken ${pair}: ${j.error?.join(', ')}`)
  const key = Object.keys(j.result).find((k) => k !== 'last')!
  return (j.result[key] as string[][]).map((r) => ({
    t: Number(r[0]),
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
  }))
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
