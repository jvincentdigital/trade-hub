import type { OHLCCandle } from '@/lib/types/market'

interface Props {
  candles: OHLCCandle[]
  entry: number
  stop?: number
  target?: number
  price?: number | null
  /** Milliseconds; draws a dotted line at the candle the trade opened in. */
  openedAt?: number
  /** Price text for the line labels. */
  fmt: (v: number) => string
  label: string
}

const W = 340
const H = 160
const PAD_R = 10

/**
 * Small candle chart with the trade's entry, stop and target as labelled
 * lines and the current price as a dot. Light SVG, no chart library.
 */
export function MiniChart({ candles, entry, stop, target, price, openedAt, fmt, label }: Props) {
  if (!candles.length) {
    return (
      <div
        style={{
          height: 120,
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
          color: 'var(--text-secondary)',
          background: 'var(--bg-secondary)',
          borderRadius: 12,
        }}
      >
        Loading chart…
      </div>
    )
  }
  const levels = [entry, stop, target, price].filter((v): v is number => v != null && v > 0)
  let lo = Math.min(...candles.map((c) => c.low), ...levels)
  let hi = Math.max(...candles.map((c) => c.high), ...levels)
  const pad = (hi - lo) * 0.09 || hi * 0.01
  lo -= pad
  hi += pad
  const y = (v: number) => ((hi - v) / (hi - lo)) * H
  const step = (W - PAD_R) / candles.length
  const body = Math.max(1.2, step * 0.62)

  // Stop and target labels sit on the left, entry on the right, so close lines don't collide.
  const line = (
    v: number | undefined,
    color: string,
    name: string,
    dash: string,
    right = false,
  ) => {
    if (v == null || !(v > 0)) return null
    const text = `${name} ${fmt(v)}`
    const w = text.length * 5.9 + 10
    const ly = Math.min(H - 8, Math.max(8, y(v)))
    const x = right ? W - w - 18 : 4
    return (
      <g key={name}>
        <line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke={color} strokeDasharray={dash} />
        <rect x={x} y={ly - 8} width={w} height={15} rx={4} fill="#111111" opacity={0.92} />
        <text x={x + 5} y={ly + 3.5} fontSize={10.5} fill={color} fontWeight={600}>
          {text}
        </text>
      </g>
    )
  }

  const hourly = candles.length > 1 && candles[1].time - candles[0].time <= 3600
  const openIdx =
    hourly && openedAt != null ? candles.findIndex((c) => (c.time + 3600) * 1000 > openedAt) : -1
  const dotX = (candles.length - 0.5) * step

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      style={{
        width: '100%',
        height: 'auto',
        display: 'block',
        background: 'var(--bg-secondary)',
        borderRadius: 12,
      }}
    >
      {openIdx >= 0 && (
        <line
          x1={openIdx * step + step / 2}
          x2={openIdx * step + step / 2}
          y1={0}
          y2={H}
          stroke="#3f3f46"
          strokeDasharray="2 3"
        />
      )}
      {candles.map((c, i) => {
        const up = c.close >= c.open
        const color = up ? '#22c55e' : '#ef4444'
        const x = i * step + step / 2
        const top = y(Math.max(c.open, c.close))
        const h = Math.max(1, Math.abs(y(c.open) - y(c.close)))
        return (
          <g key={c.time} opacity={0.8}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1} />
            <rect x={x - body / 2} y={top} width={body} height={h} fill={color} />
          </g>
        )
      })}
      {line(target, '#22c55e', 'Target', '5 4')}
      {line(stop, '#ef4444', 'Stop', '5 4')}
      {line(entry, '#a1a1aa', 'Entry', '2 3', true)}
      {price != null && price > 0 && (
        <circle cx={dotX} cy={y(price)} r={4.5} fill="#6366f1" stroke="#f0f0f0" strokeWidth={1.6} />
      )}
    </svg>
  )
}
