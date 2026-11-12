import { goalBar, signedShort, usdShort } from '@/lib/positions/today'
import {
  FUNDED,
  fundedTest,
  sizeLabel,
  type FundedTestId,
  type FundedView,
} from '@/lib/race/funded'
import { pct } from './format'
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
  /** Open P&L: the funded test's open trades now, before fees. */
  pnl: number
  /** The funded test's closed trades (after fees) minus entry fees still owed (settledSoFar). */
  settled: number
  /** When the funded test started ("7:12 PM"), or null before it has. */
  since: string | null
  /** The funded test's limits right now, or null before it has started. */
  funded: FundedView | null
  /** Clock text of a Unix-seconds time ("7:00 PM"). */
  clockOf: (sec: number) => string
  series: { t: number; pnl: number }[]
  sinceText: string | null
  hit: { stop: number; target: number }
  /** "1 trade isn't counted: it has no stop or target." */
  notCounted: string | null
  lookLine: string | null
  needsLook: boolean
  closedToday: string | null
  /** The size shown ($10K, $50K, $100K or $200K): the card's numbers are that account's. */
  startMoney: number
  /** The test shown: v1 only or v1 + breakouts. */
  test: FundedTestId
  riskPct: number
  /** The v1 only | v1 + breakouts and $10K | $50K | $100K | $200K switches (SizeSwitch.tsx). */
  sizeSwitch?: React.ReactNode
}

/**
 * The cockpit: the funded test's result (closed trades + open P&L - fees),
 * its challenge limits, the open P&L's path since the first entry, where the
 * result could end, one plain line.
 */
export function Summary(p: Props) {
  // John, 2026-11-11: the big number showed only open trades (+$966, green)
  // while closed trades had lost $1,083. It now counts both.
  const result = p.settled + p.pnl
  const ends = { stop: p.settled + p.hit.stop, target: p.settled + p.hit.target }
  const bar = goalBar(ends, result)
  // Whole dollars at the bar's ends; cents only on the Now tag.
  const stopEnd = signedShort(Math.round(ends.stop))
  const targetEnd = signedShort(Math.round(ends.target))
  const shown = p.count > 0 || p.settled !== 0
  return (
    <section aria-label="Summary" style={{ ...card, padding: '16px 18px' }}>
      {p.sizeSwitch && <div style={{ marginBottom: 14 }}>{p.sizeSwitch}</div>}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ ...secondary, fontSize: FS.sm, fontWeight: 500 }}>
            {`${FUNDED.name} ${sizeLabel(p.startMoney)}, ${fundedTest(p.test).label}${p.since ? `, started ${p.since}` : ''}`}
          </p>
          {!p.failed && (
            <p
              style={{
                ...num,
                fontSize: FS.hero,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: '-0.03em',
                color: shown ? tone(result) : 'var(--text-secondary)',
              }}
            >
              {pnlText(shown ? result : 0)}
            </p>
          )}
          {!p.failed && p.settled !== 0 && (
            <p style={{ ...secondary, fontSize: FS.sm, marginTop: 4 }} data-testid="result-parts">
              <span style={{ whiteSpace: 'nowrap' }}>{signedShort(Math.round(p.pnl))} open</span>
              {', '}
              <span style={{ whiteSpace: 'nowrap' }}>
                {signedShort(Math.round(p.settled))} closed and fees
              </span>
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
                  : p.funded
                    ? 'No trades open right now.'
                    : `Starts with ${usdShort(p.startMoney)} at the next race check.`}
          </p>
        </div>
        {sparkReady(p.series) && p.sinceText && (
          <Spark series={p.series} pnl={p.pnl} caption={p.sinceText} />
        )}
      </div>

      {p.funded && <Challenge v={p.funded} clockOf={p.clockOf} />}

      {bar && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: FS.sm, fontWeight: 600, marginBottom: 40 }}>
            Where the result could end
          </p>
          <div
            role="img"
            aria-label={`Now ${pnlText(result)}, between ${stopEnd} if every trade hits its stop and ${targetEnd} if every one hits its target`}
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
                background: tone(result),
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
              Now <span style={{ color: tone(result) }}>{pnlText(result)}</span>
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
        This{' '}
        <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {usdShort(p.startMoney)} play account
        </b>{' '}
        {p.test === 'breakouts'
          ? "takes John's London v1 signals first, then the London breakout's, and risks"
          : "takes only John's London v1 signals and risks"}{' '}
        <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          {p.riskPct}% ({usdShort((p.startMoney * p.riskPct) / 100)})
        </b>{' '}
        per trade, with FTMO-style limits. All four sizes follow the same rules and signals. Each
        strategy&apos;s own account is on the Compare tab.
      </p>
    </section>
  )
}

const STATUS = {
  active: { text: 'Active', color: 'var(--text-secondary)', background: 'var(--bg-hover)' },
  passed: { text: 'Passed', color: 'var(--green)', background: 'var(--green-dim)' },
  failed: { text: 'Failed', color: 'var(--red)', background: 'var(--red-dim)' },
} as const

/** A round limit in a tile: "$20K" from $10,000 up, so "+$1,343 of +$20K" fits on a phone. */
const limitShort = (n: number) =>
  n >= 10_000 && n % 1000 === 0 ? `$${n / 1000}K` : usdShort(Math.round(n))

/** The challenge: target, day loss, max loss and trading days, plus today's caps. */
function Challenge({ v, clockOf }: { v: FundedView; clockOf: (sec: number) => string }) {
  const st = STATUS[v.status]
  // Both as a share of the start money, like FTMO: $500 is 5%, $1,000 is 10%.
  const dayPct = (v.dayLoss / v.dayLimit) * FUNDED.dailyLossPct
  const maxPct = ((v.maxLoss / v.maxLimit) * FUNDED.maxLossPct) as number
  const summary = `${FUNDED.name} ${sizeLabel(v.startMoney)}: ${pnlText(v.result)}, day loss used ${pct(dayPct)} of ${FUNDED.dailyLossPct}%, ${pct(maxPct)} of ${FUNDED.maxLossPct}% max, ${v.days} of ${FUNDED.minDays} days, target +${usdShort(v.target)}`
  return (
    <div style={{ marginTop: 16 }} data-testid="challenge">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: FS.sm, fontWeight: 600 }}>Challenge</p>
        <span
          style={{
            fontSize: FS.xs,
            fontWeight: 600,
            padding: '2px 10px',
            borderRadius: 999,
            color: st.color,
            background: st.background,
          }}
        >
          {st.text}
        </span>
      </div>
      {v.status !== 'active' && v.statusNote && (
        <p
          role="status"
          style={{
            marginTop: 8,
            padding: '10px 12px',
            borderRadius: 12,
            fontSize: FS.sm,
            color: st.color,
            background: st.background,
          }}
        >
          {v.status === 'failed' ? 'Failed: ' : 'Passed: '}
          {v.statusNote}
          {v.statusAt ? ` (${clockOf(v.statusAt)})` : ''}. No new trades.
        </p>
      )}
      <div
        role="group"
        aria-label={summary}
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}
      >
        <Meter
          label="Target"
          value={`${signedShort(Math.round(v.result))} of +${limitShort(v.target)}`}
          share={v.result / v.target}
          color="var(--green)"
          sub={`+${FUNDED.targetPct}% to pass`}
        />
        <Meter
          label="Day loss"
          value={`${usdShort(Math.round(v.dayLoss))} of ${limitShort(v.dayLimit)}`}
          share={v.dayLoss / v.dayLimit}
          color={v.dayStopped ? 'var(--amber)' : 'var(--red)'}
          sub={`${pct(dayPct)} of ${FUNDED.dailyLossPct}% used`}
        />
        <Meter
          label="Max loss"
          value={`${usdShort(Math.round(v.maxLoss))} of ${limitShort(v.maxLimit)}`}
          share={v.maxLoss / v.maxLimit}
          color="var(--red)"
          sub={`${pct(maxPct)} of ${FUNDED.maxLossPct}% used`}
        />
        <Meter
          label="Trading days"
          value={`${v.days} of ${FUNDED.minDays}`}
          share={v.days / FUNDED.minDays}
          color="var(--indigo)"
          sub="at least, to pass"
        />
      </div>
      <p style={{ ...secondary, fontSize: FS.xs, marginTop: 8 }}>
        {/* One string: JSX text with entities can lose a space (docs/dashboard.md, Gotcha). */}
        {`Today ${v.newToday} of ${FUNDED.maxNewPerDay} new trades, ${v.openCount} of ${FUNDED.sizing.maxOpen} open. The day resets at ${clockOf(v.nextDay)} (midnight in Prague). A new trade opens only if the day's worst case, every open trade hitting its stop, stays under ${usdShort((v.startMoney * FUNDED.worstCasePct) / 100)}.`}
      </p>
      {v.status === 'active' && v.dayStopped && (
        <p style={{ fontSize: FS.sm, marginTop: 6, color: 'var(--amber)' }}>
          {`The day is down ${usdShort((v.dayLimit * FUNDED.dayStopPct) / FUNDED.dailyLossPct)} (${FUNDED.dayStopPct}% of the start): no new trades until ${clockOf(v.nextDay)}.`}
        </p>
      )}
    </div>
  )
}

function Meter(props: { label: string; value: string; share: number; color: string; sub: string }) {
  const w = Math.max(0, Math.min(1, props.share)) * 100
  return (
    <div
      style={{ background: 'var(--bg-hover)', borderRadius: 12, padding: '10px 12px', minWidth: 0 }}
    >
      <p style={{ ...secondary, fontSize: FS.xs }}>{props.label}</p>
      <p style={{ ...num, fontSize: FS.sm, fontWeight: 600, textWrap: 'balance' }}>{props.value}</p>
      <span
        aria-hidden
        style={{
          display: 'block',
          height: 6,
          margin: '6px 0 4px',
          borderRadius: 999,
          background: 'var(--border)',
          overflow: 'hidden',
        }}
      >
        <span
          style={{ display: 'block', width: `${w}%`, height: '100%', background: props.color }}
        />
      </span>
      <p style={{ ...secondary, fontSize: FS.xs }}>{props.sub}</p>
    </div>
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
        aria-label={`Open trades ${caption.toLowerCase()}, now ${pnlText(pnl)}`}
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
      <figcaption style={{ ...secondary, fontSize: FS.xs, marginTop: 2 }}>
        Open trades
        <br />
        {caption}
      </figcaption>
    </figure>
  )
}
