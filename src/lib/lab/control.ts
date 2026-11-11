// Strategy lab control: the coin flip. Random entries (a fixed seed, about
// one every 20 candles, random direction), stop 1.5x ATR(14), target 2x the
// stop. It has no edge by design, so it shows what luck alone looks like. Its
// six seeds are its "parameters": the walk-forward picks the luckiest seed
// in-sample, exactly as it picks a real bot's best settings. Pure, tested.

import type { OHLCCandle } from '../types/market'
import { atrSeries } from '../race/londonBreakout'
import type { LabEntry } from './engine'

export const COIN_EVERY = 20
const STOP_ATR = 1.5
const RR = 2

/** Small fast seeded generator (mulberry32), numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function coinFlip(c: OHLCCandle[], seed: number, atr = atrSeries(c, 14)): LabEntry[] {
  const rnd = seeded(seed)
  const out: LabEntry[] = []
  for (let j = 14; j < c.length - 1; j++) {
    const go = rnd() < 1 / COIN_EVERY
    const long = rnd() < 0.5
    if (!go || !(atr[j] > 0)) continue
    const d = STOP_ATR * atr[j]
    const ref = c[j].close
    out.push({
      i: j + 1,
      kind: 'market',
      direction: long ? 'long' : 'short',
      stop: long ? ref - d : ref + d,
      target: long ? ref + RR * d : ref - RR * d,
      signalTime: c[j].time,
    })
  }
  return out
}
