import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { raceStateSchema } from '@/lib/race/live'

// Live strategy race: reads the local state file written by `make race-tick`.
// Only meaningful on the machine running the ticks; elsewhere it says "none".
export const dynamic = 'force-dynamic'

const FILE = process.env.RACE_FILE || join(homedir(), '.local/share/trade-hub/race.json')
const PLIST = join(homedir(), 'Library/LaunchAgents/com.jvd.trade-hub-race.plist')

export async function GET() {
  const installed = existsSync(PLIST)
  if (!existsSync(FILE)) return NextResponse.json({ state: null, installed })
  try {
    const parsed = raceStateSchema.safeParse(JSON.parse(readFileSync(FILE, 'utf8')))
    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, '[api/race] invalid race file')
      return NextResponse.json({ error: 'Race file is not valid' }, { status: 500 })
    }
    return NextResponse.json({ state: parsed.data, installed })
  } catch (err) {
    logger.error({ err }, '[api/race] read failed')
    return NextResponse.json({ error: 'Could not read the race file' }, { status: 500 })
  }
}
