import { useSyncExternalStore } from 'react'
import {
  astClock,
  BST_NOTE,
  londonOnSummerTime,
  londonStatus,
  untilText,
} from '@/lib/positions/london'
import { FS, card, secondary } from './ui'

const HOUR = 3_600_000
const noop = () => () => {}

/**
 * A small line at the top of Today around the London open (docs/london-open.md):
 * a countdown in the evening before, then "Breakouts are on" from 2:00 AM,
 * "Frankfurt is open" from 3:00 and "London is open" from 4:00 to 7:00 AM
 * Puerto Rico time. Hidden the rest of the time. Drawn in the browser only:
 * its minute-level text would rarely match a server render made a moment
 * earlier.
 */
export function LondonStrip({ now }: { now: number }) {
  const browser = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
  const s = londonStatus(now)
  if (!browser || !s) return null
  const live = s.phase !== 'soon'
  const [title, body] =
    s.phase === 'soon'
      ? [
          `London session in ${untilText(s.startsAt - now)}`,
          `Breakouts start ${astClock(s.startsAt)}, Frankfurt opens ${astClock(s.frankfurtAt)}, London ${astClock(s.opensAt)}. Pound and gold breakouts are checked every 15 minutes; Claude's picks at 3:47 AM.`,
        ]
      : s.phase === 'preopen'
        ? [
            `Breakouts are on, London in ${untilText(s.opensAt - now)}`,
            `The Asian range is set. Frankfurt opens ${astClock(s.frankfurtAt)}, London ${astClock(s.opensAt)}. Breakouts count until ${astClock(s.opensAt + 2 * HOUR)}, checked every 15 minutes.`,
          ]
        : s.phase === 'frankfurt'
          ? [
              `Frankfurt is open, London in ${untilText(s.opensAt - now)}`,
              `The Asian range is set. Breakouts count until ${astClock(s.opensAt + 2 * HOUR)}, checked every 15 minutes.`,
            ]
          : [
              'London is open',
              now < s.breakoutsUntil
                ? `Until ${astClock(s.endsAt)}. Breakouts count until ${astClock(s.breakoutsUntil)}.`
                : `Until ${astClock(s.endsAt)}. No new breakouts today; open trades are still checked every 15 minutes.`,
            ]
  const line = londonOnSummerTime(now) ? `${body} ${BST_NOTE}` : body
  return (
    <section
      aria-label="London open"
      style={{
        ...card,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '12px 16px',
        marginTop: 12,
      }}
    >
      <span
        aria-hidden
        style={{
          flex: 'none',
          width: 8,
          height: 8,
          marginTop: 7,
          borderRadius: 999,
          background: live ? 'var(--green)' : 'var(--text-secondary)',
        }}
      />
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: FS.sm, fontWeight: 600 }}>{title}</p>
        <p style={{ ...secondary, fontSize: FS.xs, marginTop: 2 }}>{line}</p>
      </div>
    </section>
  )
}
