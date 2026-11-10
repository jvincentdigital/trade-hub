// Small display helpers for the home screen.

export const usd = (n: number) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const signedUsd = (n: number) => `${n < -0.005 ? '-' : '+'}${usd(n)}`

export const pct = (n: number, signed = false) =>
  `${signed ? (n < 0 ? '-' : '+') : ''}${Math.abs(n) < 10 ? Math.abs(n).toFixed(2) : Math.abs(n).toFixed(1)}%`

export function ago(ms: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}
