import { goalBar, signedShort, usdShort } from '@/lib/positions/today'
import { FS, card, num, pnlText, secondary, tone } from './ui'

/** Shown in the summary and the list when the race feed fails and there are no rows. */
export const FAILED_TEXT = "Couldn't load your trades. Trying again in a minute."

/**
 * The P&L line waits for a real path: at least 4 points over 2 hours or more
 * (points are an hour apart), else it is a straight ramp that looks unfinished.
 */
const sparkReady = (s: { t: number }[]) => s.length >= 4 && s[s.length - 1].t - s[0].t >= 7_200_000

interface Props {
  loading: boolean
  /** The race feed failed and no trades are known: no $0.00, no "No trades open". */
  failed: boolean
  /** Open trades right now. */
  count: number
  countLine: string
  pnl: number
  series: { t: number; pnl: number }[]
  sinceText: string | null
  hit: { stop: number; target: number }
  /** "1 trade isn't counted: it has no stop or target." */
  notCounted: string | null
  lookLine: string | null
  needsLook: boolean
  closedToday: string | null
  startMoney: number
  riskPct: number
}

/** The cockpit: open P&L, its path since the first entry, where today could end, one plain line. */
export function Summary(p: Props) {
  const bar = goalBar(p.hit, p.pnl)
  // Whole dollars at the bar's ends; cents only on the Now tag.
  const stopEnd = signedShort(Math.round(p.hit.stop))
  const targetEnd = signedShort(Math.round(p.hit.target))
  return (
    <section aria-label="Summary" style={{ ...card, padding: '16px 18px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ ...secondary, fontSize: FS.sm, fontWeight: 500 }}>Open P&amp;L</p>
          {!p.failed && (
            <p
              style={{
                ...num,
                fontSize: FS.hero,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: '-0.03em',
                color: p.count ? tone(p.pnl) : 'var(--text-secondary)',
              }}
            >
              {pnlText(p.count ? p.pnl : 0)}
            </p>
          )}
          <p
            style={{
              fontSize: FS.sm,
              marginTop: 6,
              color: p.failed ? 'var(--amber)' : 'var(--text-secondary)',
            }}
          >
            {p.failed
              ? FAILED_TEXT
              : p.count
                ? p.countLine
                : p.loading
                  ? 'Loading your trades…'
                  : 'No trades open right now.'}
          </p>
        </div>
        {sparkReady(p.series) && p.sinceText && (
          <Spark series={p.series} pnl={p.pnl} caption={p.sinceText} />
        )}
      </div>

      {bar && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: FS.sm, fontWeight: 600, marginBottom: 40 }}>
            Where today could end
          </p>
          <div
            role="img"
            aria-label={`Now ${pnlText(p.pnl)}, between ${stopEnd} if every trade hits its stop and ${targetEnd} if every one hits its target`}
            style={{
              position: 'relative',
              height: 10,
              borderRadius: 999,
              background: 'var(--bg-hover)',
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: `0 ${100 - bar.zero}% 0 0`,
                borderRadius: '999px 0 0 999px',
                background: 'var(--red-dim)',
              }}
            />
            <span
              style={{
                position: 'absolute',
                inset: `0 0 0 ${bar.zero}%`,
                borderRadius: '0 999px 999px 0',
                background: 'var(--green-dim)',
              }}
            />
            <span
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${Math.min(bar.zero, bar.now)}%`,
                width: `${Math.abs(bar.now - bar.zero)}%`,
                borderRadius: 999,
                background: tone(p.pnl),
              }}
            />
            <span
              style={{
                position: 'absolute',
                top: -4,
                bottom: -4,
                left: `${bar.zero}%`,
                width: 2,
                marginLeft: -1,
                borderRadius: 2,
                background: 'var(--text-muted)',
              }}
            />
            <span
              style={{
                position: 'absolute',
                top: '50%',
                left: `${bar.now}%`,
                width: 18,
                height: 18,
                margin: '-9px 0 0 -9px',
                borderRadius: '50%',
                background: 'var(--indigo)',
                border: '3px solid var(--text-primary)',
                boxShadow: '0 0 0 4px var(--indigo-dim)',
              }}
            />
            <span
              style={{
                ...num,
                position: 'absolute',
                bottom: 18,
                left: `clamp(56px, ${bar.now}%, calc(100% - 56px))`,
                transform: 'translateX(-50%)',
                padding: '3px 8px',
                borderRadius: 8,
                background: 'var(--bg-hover)',
                border: '0.5px solid var(--border)',
                fontSize: FS.xs,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Now <span style={{ color: tone(p.pnl) }}>{pnlText(p.pnl)}</span>
            </span>
          </div>
          <div
            style={{
              ...secondary,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              marginTop: 10,
              fontSize: FS.xs,
              lineHeight: 1.3,
            }}
          >
            <p>
              If all hit the stop
              <b style={{ ...num, display: 'block', fontSize: FS.md, color: 'var(--red)' }}>
                {stopEnd}
              </b>
            </p>
            <p style={{ textAlign: 'right' }}>
              If all hit the target
              <b style={{ ...num, display: 'block', fontSize: FS.md, color: 'var(--green)' }}>
                {targetEnd}
              </b>
            </p>
          </div>
          {p.notCounted && (
            <p style={{ ...secondary, fontSize: FS.xs, marginTop: 8 }}>{p.notCounted}</p>
          )}
        </div>
      )}

      {p.lookLine && (
        <p
          style={{
            marginTop: 16,
            padding: '10px 12px',
            borderRadius: 12,
            background: 'var(--bg-hover)',
            fontSize: FS.sm,
            display: 'flex',
            gap: 8,
            alignItems: 'baseline',
            textWrap: 'pretty',
          }}
        >
          <span
            aria-hidden
            style={{
              flex: 'none',
              width: 8,
              height: 8,
              borderRadius: '50%',
              // Green is for money only; a calm line gets a quiet dot.
              background: p.needsLook ? 'var(--amber)' : 'var(--text-secondary)',
            }}
          />
          <span>{p.lookLine}</span>
        </p>
      )}
      {p.closedToday && (
        <p style={{ fontSize: FS.sm, marginTop: 10 }} data-testid="closed-today">
          {p.closedToday}
        </p>
      )}
      <p style={{ ...secondary, fontSize: FS.sm, marginTop: 10 }}>
        Each strategy has its own{' '}
        <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {usdShort(p.startMoney)} play account
        </b>{' '}
        and risks{' '}
        <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {p.riskPct}% ({usdShort((p.startMoney * p.riskPct) / 100)})
        </b>{' '}
        per trade.
      </p>
    </section>
  )
}

/** Small line of the open P&L since the first open trade, with $0 dashed. */
function Spark({
  series,
  pnl,
  caption,
}: {
  series: { t: number; pnl: number }[]
  pnl: number
  caption: string
}) {
  const W = 132
  const H = 56
  const pad = 4
  const t0 = series[0].t
  const t1 = series[series.length - 1].t
  const vals = series.map((s) => s.pnl)
  const lo = Math.min(0, ...vals)
  const hi = Math.max(0, ...vals)
  const x = (t: number) => pad + ((t - t0) / (t1 - t0 || 1)) * (W - pad * 2)
  const y = (v: number) => pad + ((hi - v) / (hi - lo || 1)) * (H - pad * 2)
  const pts = series.map((s) => `${x(s.t).toFixed(1)},${y(s.pnl).toFixed(1)}`)
  const color = tone(pnl)
  return (
    <figure style={{ flex: '0 1 132px', minWidth: 96, textAlign: 'right' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Open P&L ${caption.toLowerCase()}, now ${pnlText(pnl)}`}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      >
        <line
          x1={pad}
          x2={W - pad}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--border-hover)"
          strokeDasharray="3 3"
        />
        <path
          d={`M${x(t0)},${y(0)} L${pts.join(' L')} L${x(t1)},${y(0)} Z`}
          fill={color}
          opacity={0.12}
        />
        <polyline
          points={pts.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={x(t1)} cy={y(pnl)} r={3.5} fill={color} />
      </svg>
      <figcaption style={{ ...secondary, fontSize: FS.xs, marginTop: 2 }}>{caption}</figcaption>
    </figure>
  )
}
