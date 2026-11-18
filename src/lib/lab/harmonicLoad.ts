// Harmonic study (docs/harmonic-study.md): read one 1-minute gzip CSV into
// typed arrays (Node only). Header: time,open,high,low,close,volume; time is
// the UTC second of the candle's open, prices are the Bid. Refuses a row that
// is malformed or out of order.

import { createReadStream } from 'node:fs'
import { createGunzip } from 'node:zlib'
import type { Bars } from './harmonicFind'

const HEADER = 'time,open,high,low,close,volume'

/** Stream a gzip CSV into Bars. Throws on a bad header, a bad row or a time not after the last. */
export async function loadBars(file: string): Promise<Bars> {
  let cap = 1 << 20
  let time = new Float64Array(cap)
  let open = new Float64Array(cap)
  let high = new Float64Array(cap)
  let low = new Float64Array(cap)
  let close = new Float64Array(cap)
  let n = 0
  let line = 0
  let rest = ''
  let prev = -Infinity

  const grow = () => {
    cap *= 2
    const g = (a: Float64Array) => {
      const b = new Float64Array(cap)
      b.set(a)
      return b
    }
    time = g(time)
    open = g(open)
    high = g(high)
    low = g(low)
    close = g(close)
  }

  const row = (s: string) => {
    line++
    if (line === 1) {
      if (s.trim() !== HEADER) throw new Error(`${file}: header is not "${HEADER}"`)
      return
    }
    if (s === '') throw new Error(`${file}: empty line ${line}`)
    const f = s.split(',')
    if (f.length !== 6) throw new Error(`${file}: line ${line} has ${f.length} fields`)
    const t = Number(f[0])
    const o = Number(f[1])
    const h = Number(f[2])
    const l = Number(f[3])
    const c = Number(f[4])
    const v = Number(f[5])
    if (
      f.some((x) => x.trim() === '') ||
      !Number.isInteger(t) ||
      t % 60 !== 0 ||
      ![o, h, l, c, v].every(Number.isFinite) ||
      !(l <= o && l <= c && h >= o && h >= c)
    )
      throw new Error(`${file}: malformed line ${line}`)
    if (t <= prev) throw new Error(`${file}: line ${line} is out of order`)
    prev = t
    if (n === cap) grow()
    time[n] = t
    open[n] = o
    high[n] = h
    low[n] = l
    close[n] = c
    n++
  }

  const stream = createReadStream(file).pipe(createGunzip())
  stream.setEncoding('utf8')
  for await (const chunk of stream as AsyncIterable<string>) {
    const s = rest + chunk
    let from = 0
    for (let at = s.indexOf('\n'); at >= 0; at = s.indexOf('\n', from)) {
      row(s.charCodeAt(at - 1) === 13 ? s.slice(from, at - 1) : s.slice(from, at))
      from = at + 1
    }
    rest = s.slice(from)
  }
  if (rest !== '') row(rest.endsWith('\r') ? rest.slice(0, -1) : rest)
  if (line === 0) throw new Error(`${file}: empty file`)

  return {
    n,
    time: time.slice(0, n),
    open: open.slice(0, n),
    high: high.slice(0, n),
    low: low.slice(0, n),
    close: close.slice(0, n),
  }
}
