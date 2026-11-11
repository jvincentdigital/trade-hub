import { NextResponse, type NextRequest } from 'next/server'
import { logger } from '@/lib/logger'
import { COOKIE, unlocked } from '@/lib/lock'
import { CLOSE_ID, findOpen } from '@/lib/race/closeRequests'
import { parseRaceState } from '@/lib/race/live'
import { addCloseRequest, readRace } from '@/lib/race/store'

// Close now (Today, John 2026-11-11): store a close request for one open race
// trade. The Mac's next race check books it at the minute of the tap; this
// route never touches the race itself (docs/live.md). Play money only.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // src/proxy.ts already locks /api/*; checked here too because this one changes trades.
  if (!(await unlocked(req.cookies.get(COOKIE)?.value)))
    return NextResponse.json({ error: 'Locked' }, { status: 401 })
  // JSON only: a plain cross-site form can't send it (and the cookie is SameSite=Lax).
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'Send JSON' }, { status: 415 })
  const body: unknown = await req.json().catch(() => null)
  const id = body && typeof body === 'object' && 'id' in body ? body.id : null
  if (typeof id !== 'string' || !CLOSE_ID.test(id))
    return NextResponse.json({ error: 'Not a trade' }, { status: 400 })
  try {
    const { raw } = await readRace(true)
    const parsed = raw == null ? null : parseRaceState(raw)
    if (!parsed?.ok || !findOpen(parsed.state, id))
      return NextResponse.json({ error: 'That trade is not open any more.' }, { status: 404 })
    return NextResponse.json(await addCloseRequest(id))
  } catch (err) {
    logger.error({ err }, '[api/race/close] failed')
    return NextResponse.json({ error: 'Could not send the close. Try again.' }, { status: 502 })
  }
}
