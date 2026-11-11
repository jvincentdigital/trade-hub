// Trade Hub race relay (Cloudflare Worker + KV, free plan).
// The Mac Mini PUTs the latest race state after each tick (WRITE_KEY);
// the live Trade Hub reads it server-side (READ_KEY). Play money data only.
// Free plan stops at its limits (it never bills): under 100 writes a day here.
//
// /close-requests (2026-11-11): "Close now" on Today. The site stores a
// request (POST, read key: the site's only key); the Mac's next race check
// reads them (GET) and removes the ones it booked (DELETE, write key only).
// One KV key holds them all, so the site's 60-second reads stay plain GETs.

const MAX_BYTES = 1_000_000
const MAX_REQUESTS = 50
/** "<account>|<market>|<entry time>": the same pattern as CLOSE_ID in src/lib/race/closeRequests.ts. */
const CLOSE_ID = /^[a-z0-9-]{1,64}\|[A-Za-z0-9-]{1,32}\|\d{1,12}$/

function authorized(req, key) {
  return Boolean(key) && req.headers.get('authorization') === `Bearer ${key}`
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

async function readRequests(env) {
  try {
    const all = JSON.parse((await env.RACE.get('close-requests')) ?? '{}')
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {}
  } catch {
    return {}
  }
}

async function bodyOf(req) {
  const text = await req.text()
  if (text.length > 10_000) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function closeRequests(req, env) {
  const site = authorized(req, env.READ_KEY)
  const mac = authorized(req, env.WRITE_KEY)
  if (req.method === 'GET') {
    if (!site && !mac) return new Response('Unauthorized', { status: 401 })
    return json(await readRequests(env))
  }
  if (req.method === 'POST') {
    if (!site && !mac) return new Response('Unauthorized', { status: 401 })
    const body = await bodyOf(req)
    const id = body?.id
    if (typeof id !== 'string' || !CLOSE_ID.test(id)) return new Response('Bad id', { status: 400 })
    const all = await readRequests(env)
    // A second tap on the same trade keeps the first tap's time.
    if (all[id]) return json({ request: all[id], duplicate: true })
    if (Object.keys(all).length >= MAX_REQUESTS) return new Response('Too many', { status: 429 })
    const request = { id, at: Date.now() }
    all[id] = request
    await env.RACE.put('close-requests', JSON.stringify(all))
    return json({ request, duplicate: false })
  }
  if (req.method === 'DELETE') {
    if (!mac) return new Response('Unauthorized', { status: 401 })
    const body = await bodyOf(req)
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string') : null
    if (!ids) return new Response('Bad ids', { status: 400 })
    const all = await readRequests(env)
    const gone = ids.filter((id) => all[id])
    if (gone.length) {
      for (const id of gone) delete all[id]
      await env.RACE.put('close-requests', JSON.stringify(all))
    }
    return json({ removed: gone.length })
  }
  return new Response('Method not allowed', { status: 405 })
}

const worker = {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (url.pathname === '/close-requests') return closeRequests(req, env)
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
