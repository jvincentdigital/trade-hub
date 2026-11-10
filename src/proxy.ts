import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE, passHash } from '@/lib/lock'

// Passcode lock for the live site. Pages redirect to /unlock; API routes
// answer 401 so data never leaks without the cookie. See docs/live.md.
export async function proxy(req: NextRequest) {
  const pass = process.env.TRADE_HUB_PASSCODE
  if (!pass) return NextResponse.next()
  if (req.cookies.get(COOKIE)?.value === (await passHash(pass))) return NextResponse.next()
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Locked' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/unlock'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  // Only these exact public paths skip the lock (a prefix like "unlock" would also open "/unlocked-page").
  // The manifest and icons stay public because phones fetch them without the cookie.
  matcher: [
    '/((?!unlock$|_next/|_vercel/|manifest\\.webmanifest$|icon[^/]*$|apple-icon[^/]*$|favicon\\.ico$).*)',
  ],
}
