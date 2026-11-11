import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { parseRaceState } from '@/lib/race/live'
import { readCloseRequests, readRace } from '@/lib/race/store'
import type { CloseRequests } from '@/lib/race/closeRequests'

// Live strategy race. On the live site (RACE_URL + RACE_KEY set) it reads the
// latest state from the race relay worker, which the Mac Mini updates after
// every check (docs/live.md). Locally it reads the file written by
// `make race-tick`. Also the pending Close now requests (Today shows them).
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { raw, installed } = await readRace()
    // A failed read of the requests never hides the race.
    const closeRequests: CloseRequests = await readCloseRequests().catch((err) => {
      logger.error({ err }, '[api/race] close requests read failed')
      return {}
    })
    if (raw == null) return NextResponse.json({ state: null, installed, closeRequests })
    // An old file (money split per market) is shown in the new layout until the next tick or reset.
    const parsed = parseRaceState(raw)
    if (!parsed.ok) {
      logger.error({ error: parsed.error }, '[api/race] invalid race state')
      return NextResponse.json({ error: 'Race state is not valid' }, { status: 500 })
    }
    return NextResponse.json({ state: parsed.state, installed, closeRequests })
  } catch (err) {
    logger.error({ err }, '[api/race] read failed')
    return NextResponse.json({ error: 'Could not read the race' }, { status: 500 })
  }
}
