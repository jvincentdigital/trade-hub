import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { closeRequestsSchema, type CloseRequest, type CloseRequests } from './closeRequests'

// Server only (the /api/race routes). On the live site (RACE_URL + RACE_KEY
// set) the race and the Close now requests live in the race relay worker,
// which the Mac Mini updates after every check (docs/live.md). Locally they
// are files: the one `make race-tick` writes, and close-requests.json next to it.

const FILE = process.env.RACE_FILE || join(homedir(), '.local/share/trade-hub/race.json')
const CLOSE_FILE = process.env.RACE_CLOSE_FILE || join(dirname(FILE), 'close-requests.json')
const PLIST = join(homedir(), 'Library/LaunchAgents/com.jvd.trade-hub-race.plist')

const worker = () => {
  const { RACE_URL, RACE_KEY } = process.env
  return RACE_URL && RACE_KEY ? { url: RACE_URL, key: RACE_KEY } : null
}
const auth = (key: string) => ({ authorization: `Bearer ${key}` })

/** The raw race state (null before the first tick) and whether the job is installed. */
export async function readRace(fresh = false): Promise<{ raw: unknown; installed: boolean }> {
  const w = worker()
  if (w) {
    // Cached 60 s on the server so many page views make few worker reads.
    const res = await fetch(w.url, {
      headers: auth(w.key),
      ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 60 } }),
    })
    if (!res.ok) throw new Error(`race relay ${res.status}`)
    // The relay only gets data from the installed job.
    return { raw: await res.json(), installed: true }
  }
  return {
    raw: existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null,
    installed: existsSync(PLIST),
  }
}

/** Pending Close now requests; {} when none (or the old worker has no such endpoint yet). */
export async function readCloseRequests(): Promise<CloseRequests> {
  const w = worker()
  let raw: unknown = {}
  if (w) {
    const res = await fetch(new URL('/close-requests', w.url), {
      headers: auth(w.key),
      cache: 'no-store',
    })
    if (res.status === 404) return {}
    if (!res.ok) throw new Error(`close requests ${res.status}`)
    raw = await res.json()
  } else if (existsSync(CLOSE_FILE)) raw = JSON.parse(readFileSync(CLOSE_FILE, 'utf8'))
  const parsed = closeRequestsSchema.safeParse(raw)
  return parsed.success ? parsed.data : {}
}

/** Store one request. A second tap on the same trade keeps the first time (`duplicate`). */
export async function addCloseRequest(
  id: string,
): Promise<{ request: CloseRequest; duplicate: boolean }> {
  const w = worker()
  if (w) {
    const res = await fetch(new URL('/close-requests', w.url), {
      method: 'POST',
      headers: { ...auth(w.key), 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`close request ${res.status}`)
    return res.json()
  }
  const all = await readCloseRequests()
  if (all[id]) return { request: all[id], duplicate: true }
  const request = { id, at: Date.now() }
  mkdirSync(dirname(CLOSE_FILE), { recursive: true })
  writeFileSync(`${CLOSE_FILE}.tmp`, JSON.stringify({ ...all, [id]: request }))
  renameSync(`${CLOSE_FILE}.tmp`, CLOSE_FILE)
  return { request, duplicate: false }
}
