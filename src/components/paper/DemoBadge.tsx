/** Shown wherever demo trading appears so play money is never mistaken for real. */
export function DemoBadge({ text = 'DEMO · play money' }: { text?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: '10px',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--amber)',
        background: 'var(--amber-dim)',
        border: '0.5px solid var(--amber)',
        borderRadius: '5px',
        padding: '2px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  )
}
