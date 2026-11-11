import { CLAUDE_PICKS } from './claudePicks'
import { LONDON_BREAKOUT } from './londonBreakout'

/** Race strategies that are not rules (docs/london-open.md), for Today's labels. */
export const EXTRA_STRATEGIES: Record<string, { candles: string; rr: string; why: string }> = {
  [LONDON_BREAKOUT.id]: { candles: '15-minute', rr: '2x', why: LONDON_BREAKOUT.why },
  [CLAUDE_PICKS.id]: { candles: '15-minute', rr: 'at least 1.5x', why: CLAUDE_PICKS.why },
}
