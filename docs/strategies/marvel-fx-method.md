# Market Maker / Marvel FX Method: notes and testable rules

Our own summary of John's course material, written 2026-11-10. **Not course
text**: everything is paraphrased, with a source after each point.

Sources so far:

- **PDF**: `Market-Maker-Method-SquirrelFX.pdf`, module 1 (27 pages, Spanish), cited as `p.N`.
- **Videos** (22, Spanish): transcription running on the Mac Mini into
  `~/jvd-outputs/trading/transcripts/` (timestamped `[mm:ss]`). Not used yet.
  When they are done, run `make extract-strategies` to fold them in with
  `video @ mm:ss` sources (see `docs/strategy-rules.md`).

## The idea in one paragraph

Large dealers ("market makers") need retail traders on the wrong side. They
set a range, push price past it to trigger stops (the stop hunt), then move
the real way slowly. The trader's job is to recognize the trap, wait for it
to finish, and trade with the market maker instead of against it (p.2, p.7, p.25).

## Timing (New York time)

- Traps cluster at the start and end of the week, the day and each session (p.4).
- Don't hold trades over the weekend: the Sunday gap can wipe the stop (p.5).
- Day resets at 5 PM; Asian session builds the range; London open around 2:30-3:30 AM; New York around 8:30-9:30 AM; New York goes quiet around 12-1 PM (p.13).
- The two most telling candles: the 15 minutes after the London open (about 2:30-2:45) and after the US open (about 8:30-8:45) (p.13, p.23).
- If a trade hasn't moved meaningfully within about 2 hours, take the small win or loss and leave (p.7).

## The daily cycle

1. Accumulation: the session sets an initial high and low of the day (p.8, p.20).
2. Stop hunt: a fast fake move against the real direction, usually near a session open (p.8, p.20).
3. Trend move: the real move, slow and steady for roughly 6-8 hours (p.8).
4. Back to consolidation near the end of the day (p.8).

## Peak formations and levels

- W (stop hunt low) and M (stop hunt high) repeat at every scale; the second leg often ends with a spike candle that says the trap is done (p.6, p.17).
- Moves run in three levels (three pushes), each followed by a consolidation; the third level is the most aggressive (p.13, p.22).
- Price rarely runs the same direction more than three days; expect a pullback after that ("do not counter" a fresh peak formation out of level one) (p.18, p.27).
- Up cycle: W, V, V, M. Down cycle: M, A, A, W (p.16, p.25).
- Consolidation zones create fake support and resistance lines; don't trade them as real levels (p.25).
- Only four setups matter: stop-hunt high with an M, stop-hunt low with a W, sudden rise, sudden drop (p.27). The PDF claims these are 90% accurate; we treat that as a claim to test, not a fact.

## EMAs, stops and targets

- First target: the 50 EMA. Second target: the 200 EMA. Also the middle of a range ((high + low) / 2) (p.8).
- Stop: roughly 15 pips beyond the stop-hunt low (or high) of the day (p.18).
- Typical daily range limit: most pairs move at most about 200 pips a day and 600 a week (ADR) (p.14).

## News

- News releases are used as cover for the planned move; the spike is the market maker, not the headline (p.12, p.19).
- Entries after news: covered by the video "Mejores entradas despues de noticias" (pending transcript).

## Rules Trade Hub can test now (`src/lib/rules/marvel.ts`)

| Rule                             | Conditions                                                                                                                                                 | Stop / target                                                        | Sources               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------- |
| **MM stop hunt reversal** (1h)   | W or M formation with a stop hunt in the last 10 candles; hammer / spike / engulfing candle in the last 2; only London open (2:30-4) and NY open (8:30-10) | 0.15% past the 12-candle extreme; 2R target (stands in for "50 EMA") | p.27, p.18, p.20, p.8 |
| **MM three-day exhaustion** (1d) | 3 daily candles against the trade, then a reversal candle                                                                                                  | 0.15% past the 4-day extreme; 2R                                     | p.18, p.22, p.25, p.8 |

## What Trade Hub can and cannot test

- Crypto candles are 1h / 4h / 1d (built from CoinGecko hourly prices, 90 days). Forex is **daily only** with estimated highs/lows, so session filters do nothing on forex and the 1h rule only runs on crypto in practice. Crypto trades 24/7, so the "session open" idea fits it only loosely.
- No tick data, no news calendar, no volume for forex.

## Conditions to add (needs better data first)

- Asian-session range and the initial high/low of the day (needs intraday forex).
- Level counting (first / second / third push) beyond the simple "3 candles in a row".
- ADR filter (skip when today's range is already near the average daily range).
- Time stop: close if no progress after 2 hours.
- EMA-based targets (exit at the 50 EMA, then 200 EMA) instead of a fixed R multiple.
- Weekend flat: close before Friday's end.
