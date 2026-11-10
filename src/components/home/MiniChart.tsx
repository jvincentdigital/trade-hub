import type { OHLCCandle } from '@/lib/types/market'

interface Props {
  candles: OHLCCandle[]
  entry: number
  stop?: number
  target?: number
  price?: number | null
  label: string
}

const W = 320
const H = 132
const PAD_R = 4

/**
 * Small candle chart with the trade's entry, stop and target as lines and
 * the current price as a dot. Light SVG, no chart library.
 */
export function MiniChart({ candles, entry, stop, target, price, label }: Props) {
  if (!candles.length) {
    return (
      <div
        style={{
          height: 96,
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
          color: 'var(--text-muted)',
          background: 'var(--bg-secondary)',
          borderRadius: 8,
        }}
      >
        Loading chart…
      </div>
    )
  }
  const levels = [entry, stop, target, price].filter((v): v is number => v != null && v > 0)
  let lo = Math.min(...candles.map((c) => c.low), ...levels)
  let hi = Math.max(...candles.map((c) => c.high), ...levels)
  const pad = (hi - lo) * 0.08 || hi * 0.01
  lo -= pad
  hi += pad
  const y = (v: number) => ((hi - v) / (hi - lo)) * H
  const step = (W - PAD_R) / candles.length
  const body = Math.max(1, step * 0.6)

  // Stop and target labels sit on the left, entry on the right, so close lines don't collide.
  const line = (
    v: number | undefined,
    color: string,
    text: string,
    dash?: string,
    right = false,
  ) => {
    if (v == null || !(v > 0)) return null
    const w = text.length * 6 + 8
    const x = right ? W - w - 14 : 2
    return (
      <g key={text}>
        <line
          x1={0}
          x2={W}
          y1={y(v)}
          y2={y(v)}
          stroke={color}
          strokeWidth={1}
          strokeDasharray={dash}
        />
        <rect x={x} y={y(v) - 8} width={w} height={14} rx={3} fill="#0a0a0acc" />
        <text x={x + 4} y={y(v) + 3} fontSize={10} fill={color} fontWeight={600}>
          {text}
        </text>
      </g>
    )
  }

  const last = candles[candles.length - 1]
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
        borderRadius: 8,
      }}
    >
      {candles.map((c, i) => {
        const up = c.close >= c.open
        const color = up ? '#22c55e' : '#ef4444'
        const x = i * step + step / 2
        const top = y(Math.max(c.open, c.close))
        const h = Math.max(1, Math.abs(y(c.open) - y(c.close)))
        return (
          <g key={c.time} opacity={0.75}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1} />
            <rect x={x - body / 2} y={top} width={body} height={h} fill={color} />
          </g>
        )
      })}
      {line(target, '#22c55e', 'Target', '4 3')}
      {line(entry, '#a1a1aa', 'Entry', '2 3', true)}
      {line(stop, '#ef4444', 'Stop', '4 3')}
      {price != null && price > 0 && (
        <circle
          cx={dotX}
          cy={y(price ?? last.close)}
          r={4}
          fill="#6366f1"
          stroke="#f0f0f0"
          strokeWidth={1.5}
        />
      )}
    </svg>
  )
}
