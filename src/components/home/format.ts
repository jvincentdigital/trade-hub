import { MINUS } from '@/lib/positions/today'

// Small display helpers for the home screen.

export const usd = (n: number) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const signedUsd = (n: number) => `${n < -0.005 ? MINUS : '+'}${usd(n)}`

/** "1.25%"; signed: "+1.25%", "−0.08%", and "0.00%" with no sign at zero. */
export function pct(n: number, signed = false): string {
  const a = Math.abs(n)
  const text = `${a < 10 ? a.toFixed(2) : a.toFixed(1)}%`
  if (!signed || Number(text.slice(0, -1)) === 0) return text
  return `${n < 0 ? MINUS : '+'}${text}`
}

export function ago(ms: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}
