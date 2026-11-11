// One passcode, typed once per device (same approach as Idea OS). The cookie
// holds a hash of the passcode, never the passcode. No TRADE_HUB_PASSCODE set
// (local dev) = no lock.
export const COOKIE = 'trade_hub'

export async function passHash(pass: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`trade-hub:${pass}`))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** True when no passcode is set (local dev) or the cookie holds its hash. Used by src/proxy.ts and data-changing routes. */
export async function unlocked(cookie: string | undefined): Promise<boolean> {
  const pass = process.env.TRADE_HUB_PASSCODE
  if (!pass) return true
  return cookie === (await passHash(pass))
}
