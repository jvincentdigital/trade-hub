import type { CSSProperties } from 'react'
import { signedUsd } from './format'

// Shared look for the Today page: one small type scale, card and pill styles.

/** The only font sizes on Today. */
export const FS = { xs: 12, sm: 14, md: 16, lg: 20, xl: 32, hero: 40 } as const

export const card: CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 16,
}

export const secondary: CSSProperties = { color: 'var(--text-secondary)' }

export const num: CSSProperties = { fontVariantNumeric: 'tabular-nums' }

/** Green up, red down, grey at zero or unknown. */
export const tone = (n: number | null | undefined) =>
  n == null || Math.abs(n) < 0.005 ? 'var(--text-secondary)' : n > 0 ? 'var(--green)' : 'var(--red)'

/** "+$17.48", "-$0.31", "$0.00" (no sign at zero). */
export const pnlText = (n: number | null) =>
  n == null ? '-' : Math.abs(n) < 0.005 ? '$0.00' : signedUsd(n)

/** "1:35 PM" today, "Nov 8, 1:35 PM" before that. Local time. */
export function clock(ms: number, now: number): string {
  const d = new Date(ms)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === new Date(now).toDateString()) return time
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

export const button: CSSProperties = {
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '0 16px',
  borderRadius: 12,
  border: '0.5px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontSize: FS.sm,
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer',
}
