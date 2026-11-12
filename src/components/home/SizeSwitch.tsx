import { FUNDED_SIZES, sizeLabel } from '@/lib/race/funded'
import { FS } from './ui'

/** $10K | $50K | $100K | $200K: which funded test size the card shows. */
export function SizeSwitch({
  value,
  onChange,
}: {
  value: number
  onChange: (size: number) => void
}) {
  return (
    <div
      role="group"
      aria-label="Funded test size"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${FUNDED_SIZES.length}, 1fr)`,
        gap: 4,
        padding: 4,
        borderRadius: 999,
        background: 'var(--bg-hover)',
      }}
    >
      {FUNDED_SIZES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={value === s}
          onClick={() => onChange(s)}
          style={{
            minWidth: 0,
            minHeight: 44,
            border: 0,
            borderRadius: 999,
            background: value === s ? 'var(--text-primary)' : 'transparent',
            color: value === s ? 'var(--bg-primary)' : 'var(--text-secondary)',
            fontSize: FS.sm,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            cursor: 'pointer',
          }}
        >
          {sizeLabel(s)}
        </button>
      ))}
    </div>
  )
}
