import { FUNDED_SIZES, FUNDED_TESTS, sizeLabel, type FundedTestId } from '@/lib/race/funded'
import { FS } from './ui'

/** A row of pill buttons, one pressed. */
function Pills<T extends string | number>(props: {
  label: string
  options: readonly { value: T; text: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={props.label}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${props.options.length}, 1fr)`,
        gap: 4,
        padding: 4,
        borderRadius: 999,
        background: 'var(--bg-hover)',
      }}
    >
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={props.value === o.value}
          onClick={() => props.onChange(o.value)}
          style={{
            minWidth: 0,
            minHeight: 44,
            border: 0,
            borderRadius: 999,
            background: props.value === o.value ? 'var(--text-primary)' : 'transparent',
            color: props.value === o.value ? 'var(--bg-primary)' : 'var(--text-secondary)',
            fontSize: FS.sm,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}
        >
          {o.text}
        </button>
      ))}
    </div>
  )
}

const SIZES = FUNDED_SIZES.map((s) => ({ value: s as number, text: sizeLabel(s) }))
const TESTS = FUNDED_TESTS.map((t) => ({ value: t.id, text: t.label }))

/** $10K | $50K | $100K | $200K: which funded test size the card shows. */
export function SizeSwitch(props: { value: number; onChange: (size: number) => void }) {
  return <Pills label="Funded test size" options={SIZES} {...props} />
}

/** v1 only | v1 + breakouts: which funded test the card shows. */
export function TestSwitch(props: { value: FundedTestId; onChange: (test: FundedTestId) => void }) {
  return <Pills label="Funded test" options={TESTS} {...props} />
}
