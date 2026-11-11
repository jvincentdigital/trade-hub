// Strategy lab: read the history files (Node only). One gzipped CSV per
// market and timeframe: time (unix s, bar open, UTC),open,high,low,close,volume.
// See ~/jvd-outputs/trading/history/README.md.

import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import type { OHLCCandle } from '../types/market'
import type { LabMarketId, LabTf } from './markets'
import { parseNewsCsv, type NewsEvent } from './news'
import { DAY, utcWeekday } from './time'

export const DEFAULT_HISTORY_DIR = join(homedir(), 'jvd-outputs/trading/history')

export const historyFile = (dir: string, m: LabMarketId, tf: LabTf) =>
  join(dir, m, `${m}_${tf}.csv.gz`)

/** Stream one gzipped CSV into typed candles, oldest first. Throws on a bad or unsorted row. */
export async function loadCandleFile(file: string): Promise<OHLCCandle[]> {
  const lines = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  })
  const out: OHLCCandle[] = []
  let n = 0
  for await (const line of lines) {
    n++
    if (!line || (n === 1 && line.startsWith('time'))) continue
    const [t, o, h, l, c] = line.split(',')
    const bar = {
      time: Number(t),
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
    }
    if (![bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
      throw new Error(`${file}: bad row ${n}`)
    const prev = out[out.length - 1]
    if (prev && bar.time <= prev.time) throw new Error(`${file}: rows out of order at ${n}`)
    out.push(bar)
  }
  return out
}

/**
 * Forex, gold and US30 daily files have a short Sunday bar (about 21:00 to
 * 24:00 UTC, README). Merge it into Monday so a "day" is a trading day.
 */
export function mergeSundayBars(days: OHLCCandle[]): OHLCCandle[] {
  const out: OHLCCandle[] = []
  let carry = null as OHLCCandle | null
  for (const d of days) {
    if (utcWeekday(d.time) === 0) {
      const prev: OHLCCandle | null = carry
      carry = prev
        ? {
            time: prev.time,
            open: prev.open,
            high: Math.max(prev.high, d.high),
            low: Math.min(prev.low, d.low),
            close: d.close,
          }
        : { ...d }
      continue
    }
    if (carry && d.time - carry.time <= 2 * DAY) {
      out.push({
        time: d.time,
        open: carry.open,
        high: Math.max(carry.high, d.high),
        low: Math.min(carry.low, d.low),
        close: d.close,
      })
    } else {
      out.push(d)
    }
    carry = null
  }
  return out
}

export async function loadMarket(dir: string, m: LabMarketId, tf: LabTf): Promise<OHLCCandle[]> {
  const file = historyFile(dir, m, tf)
  if (!existsSync(file)) throw new Error(`missing history file ${file}`)
  const bars = await loadCandleFile(file)
  return tf === '1d' && m !== 'BTCUSDT' ? mergeSundayBars(bars) : bars
}

export async function loadNews(dir: string): Promise<NewsEvent[]> {
  return parseNewsCsv(await readFile(join(dir, 'news-high-impact.csv'), 'utf8'))
}
