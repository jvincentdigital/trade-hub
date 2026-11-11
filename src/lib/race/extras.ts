import { CLAUDE_PICKS } from './claudePicks'
import { LAB_BOTS, LAB_MAX_DAYS } from './labBots'
import { LONDON_BREAKOUT } from './londonBreakout'

/** Race strategies that are not rules (docs/london-open.md, docs/strategy-lab.md), for Today's labels. */
export const EXTRA_STRATEGIES: Record<string, { candles: string; rr: string; why: string }> = {
  [LONDON_BREAKOUT.id]: { candles: '15-minute', rr: '2x', why: LONDON_BREAKOUT.why },
  [CLAUDE_PICKS.id]: { candles: '15-minute', rr: 'at least 1.5x', why: CLAUDE_PICKS.why },
  ...Object.fromEntries(
    LAB_BOTS.map((b) => [
      b.id,
      { candles: b.candleWords, rr: b.rrWords, why: `${b.why} (${LAB_MAX_DAYS[b.style]})` },
    ]),
  ),
}
