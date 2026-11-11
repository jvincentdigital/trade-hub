'use client'

// A dollar amount box you can clear and retype. A plain controlled number input
// turned an empty box into 0 at once, so "1000" could never be erased.
import { useState, type CSSProperties } from 'react'

export function parseMoney(text: string): number | null {
  const n = Number(text.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

export function MoneyInput({
  value,
  onChange,
  label,
  style,
}: {
  value: number
  onChange: (n: number) => void
  label: string
  style?: CSSProperties
}) {
  const [text, setText] = useState(String(value))
  // Follow outside changes (e.g. a reset) without fighting the typing:
  // adjust during render when the value changed and the box doesn't already say it.
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    if (parseMoney(text) !== value) setText(String(value))
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = parseMoney(e.target.value)
        if (n !== null) onChange(n)
      }}
      // Left empty or invalid: go back to the last good amount.
      onBlur={() => setText(String(value))}
      onFocus={(e) => e.target.select()}
      aria-label={label}
      style={style}
    />
  )
}
