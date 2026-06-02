import { NextResponse } from 'next/server'

// In-memory per-IP limiter. Resets on serverless cold start, which is acceptable
// here: this is a single-user app with no auth/DB, and the main cost concern is
// burning the CoinGecko free-tier quota from the scanner route. ISR already
// caches simple proxy routes; this catches abusive burst traffic to dynamic ones.

type Scope = 'scanner' | 'data'

interface Entry {
  count: number
  resetAt: number
}

interface Config {
  max: number
  windowMs: number
}

const LIMITS: Record<Scope, Config> = {
  scanner: { max: 30, windowMs: 60_000 },
  data: { max: 120, windowMs: 60_000 },
}

const buckets: Map<string, Entry> = new Map()

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  resetAt: number
}

export function checkRateLimit(scope: Scope, identifier: string): RateLimitResult {
  const { max, windowMs } = LIMITS[scope]
  const key = `${scope}:${identifier}`
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    const entry = { count: 1, resetAt: now + windowMs }
    buckets.set(key, entry)
    return { ok: true, limit: max, remaining: max - 1, resetAt: entry.resetAt }
  }

  existing.count += 1
  const remaining = Math.max(0, max - existing.count)
  return { ok: existing.count <= max, limit: max, remaining, resetAt: existing.resetAt }
}

export function getClientIdentifier(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}

export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfter = Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000))
  return NextResponse.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
        'Retry-After': String(retryAfter),
      },
    }
  )
}
