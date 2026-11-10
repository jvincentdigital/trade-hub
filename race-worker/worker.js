// Trade Hub race relay (Cloudflare Worker + KV, free plan).
// The Mac Mini PUTs the latest race state after each hourly tick (WRITE_KEY);
// the live Trade Hub reads it server-side (READ_KEY). Play money data only.
// Free plan stops at its limits (it never bills): 24 writes a day here.

const MAX_BYTES = 1_000_000

function authorized(req, key) {
  return Boolean(key) && req.headers.get('authorization') === `Bearer ${key}`
}

const worker = {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (url.pathname !== '/race') return new Response('Not found', { status: 404 })

    if (req.method === 'GET') {
      if (!authorized(req, env.READ_KEY) && !authorized(req, env.WRITE_KEY))
        return new Response('Unauthorized', { status: 401 })
      const body = await env.RACE.get('state')
      return new Response(body ?? 'null', {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      })
    }

    if (req.method === 'PUT') {
      if (!authorized(req, env.WRITE_KEY)) return new Response('Unauthorized', { status: 401 })
      const text = await req.text()
      if (text.length > MAX_BYTES) return new Response('Too large', { status: 413 })
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        return new Response('Not JSON', { status: 400 })
      }
      if (parsed?.version !== 1 || typeof parsed.strategies !== 'object')
        return new Response('Not a race state', { status: 400 })
      await env.RACE.put('state', text)
      return new Response('ok')
    }

    return new Response('Method not allowed', { status: 405 })
  },
}

export default worker
