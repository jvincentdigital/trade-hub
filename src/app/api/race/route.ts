import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { parseRaceState } from '@/lib/race/live'

// Live strategy race. On the live site (RACE_URL + RACE_KEY set) it reads the
// latest state from the race relay worker, which the Mac Mini updates after
// every hourly tick (docs/live.md). Locally it reads the file written by
// `make race-tick`.
export const dynamic = 'force-dynamic'

const FILE = process.env.RACE_FILE || join(homedir(), '.local/share/trade-hub/race.json')
const PLIST = join(homedir(), 'Library/LaunchAgents/com.jvd.trade-hub-race.plist')

async function fromWorker(url: string, key: string) {
  // Cached 60 s on the server so many page views make few worker reads.
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${key}` },
    next: { revalidate: 60 },
  })
  if (!res.ok) throw new Error(`race relay ${res.status}`)
  return res.json()
}

export async function GET() {
  const { RACE_URL, RACE_KEY } = process.env
  try {
    let raw: unknown
    let installed: boolean
    if (RACE_URL && RACE_KEY) {
      raw = await fromWorker(RACE_URL, RACE_KEY)
      installed = true // the relay only gets data from the installed hourly job
    } else {
      installed = existsSync(PLIST)
      if (!existsSync(FILE)) return NextResponse.json({ state: null, installed })
      raw = JSON.parse(readFileSync(FILE, 'utf8'))
    }
    if (raw == null) return NextResponse.json({ state: null, installed })
    // An old file (money split per market) is shown in the new layout until the next tick or reset.
    const parsed = parseRaceState(raw)
    if (!parsed.ok) {
      logger.error({ error: parsed.error }, '[api/race] invalid race state')
      return NextResponse.json({ error: 'Race state is not valid' }, { status: 500 })
    }
    return NextResponse.json({ state: parsed.state, installed })
  } catch (err) {
    logger.error({ err }, '[api/race] read failed')
    return NextResponse.json({ error: 'Could not read the race' }, { status: 500 })
  }
}
