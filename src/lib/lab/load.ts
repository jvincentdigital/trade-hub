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
import { DAY, HOUR, nyOffset } from './time'

export const DEFAULT_HISTORY_DIR = join(homedir(), 'jvd-outputs/trading/history')
/** Older 1h history (2019 to the start of the main files), the untouched holdout. */
export const DEFAULT_OLD_HISTORY_DIR = join(homedir(), 'jvd-outputs/trading/history-old')

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
 * 4h or daily candles from 1h on the forex day: it starts at 17:00 New York
 * (21:00 UTC in US summer, 22:00 in winter), as brokers and TradingView forex
 * charts draw them. 4h candles start at 17, 21, 01, 05, 09, 13 New York. No
 * Sunday stub: the Sunday open starts Monday's candle.
 */
export function nyCloseBars(h1: OHLCCandle[], sec: number): OHLCCandle[] {
  const out: OHLCCandle[] = []
  let key = NaN
  for (const b of h1) {
    const off = nyOffset(b.time) * HOUR
    const k = Math.floor((b.time + off + 7 * HOUR) / sec)
    if (k !== key) {
      key = k
      out.push({
        time: k * sec - 7 * HOUR - off,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })
    } else {
      const c = out[out.length - 1]
      c.high = Math.max(c.high, b.high)
      c.low = Math.min(c.low, b.low)
      c.close = b.close
    }
  }
  return out
}

/** 4h or daily candles from 1h on UTC boundaries (Bitcoin, which trades every hour of the week). */
export function utcBars(h1: OHLCCandle[], sec: number): OHLCCandle[] {
  const out: OHLCCandle[] = []
  for (const b of h1) {
    const t = Math.floor(b.time / sec) * sec
    const c = out[out.length - 1]
    if (c && c.time === t) {
      c.high = Math.max(c.high, b.high)
      c.low = Math.min(c.low, b.low)
      c.close = b.close
    } else out.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close })
  }
  return out
}

/**
 * One market and candle size. 4h and daily come from the 1h file: on the
 * 17:00 New York close for forex, gold and US30, on UTC for Bitcoin.
 */
export async function loadMarket(dir: string, m: LabMarketId, tf: LabTf): Promise<OHLCCandle[]> {
  const big = tf === '4h' || tf === '1d'
  const file = historyFile(dir, m, big ? '1h' : tf)
  if (!existsSync(file)) throw new Error(`missing history file ${file}`)
  const bars = await loadCandleFile(file)
  if (!big) return bars
  const sec = tf === '4h' ? 4 * HOUR : DAY
  return m === 'BTCUSDT' ? utcBars(bars, sec) : nyCloseBars(bars, sec)
}

export async function loadNews(dir: string): Promise<NewsEvent[]> {
  return parseNewsCsv(await readFile(join(dir, 'news-high-impact.csv'), 'utf8'))
}
