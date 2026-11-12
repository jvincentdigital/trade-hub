import { CLAUDE_PICKS } from './claudePicks'
import { JOHNS_LONDON } from './johnsLondonLive'
import { JOHNS_METHOD } from './johnsMethodLive'
import { LAB_BOTS, LAB_MAX_DAYS } from './labBots'
import { LONDON_BREAKOUT } from './londonBreakout'

/** Race strategies that are not rules (docs/london-open.md, docs/strategy-lab.md), for Today's labels. */
export const EXTRA_STRATEGIES: Record<string, { candles: string; rr: string; why: string }> = {
  [LONDON_BREAKOUT.id]: { candles: '15-minute', rr: '2x', why: LONDON_BREAKOUT.why },
  [CLAUDE_PICKS.id]: { candles: '15-minute', rr: 'at least 1.5x', why: CLAUDE_PICKS.why },
  [JOHNS_LONDON.id]: {
    candles: '15-minute',
    rr: '1.5x to 2.5x, half at 0, rest at -0.272',
    why: JOHNS_LONDON.why,
  },
  [JOHNS_METHOD.id]: {
    candles: '4-hour Fib, 1-hour entries',
    rr: 'at least 1.5x, half at 0, rest at -0.272',
    why: JOHNS_METHOD.why,
  },
  ...Object.fromEntries(
    LAB_BOTS.map((b) => [
      b.id,
      { candles: b.candleWords, rr: b.rrWords, why: `${b.why} (${LAB_MAX_DAYS[b.style]})` },
    ]),
  ),
}
