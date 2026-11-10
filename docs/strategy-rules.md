# Strategy rules (signals, backtests, one-tap demo trades)

Added 2026-11-10. Lives at the top of `/strategies`.

## What a rule is

A `Rule` (`src/lib/rules/schema.ts`, Zod) says: on these markets and this
candle size, when **all** these conditions are true on a closed candle, enter
this way, with this stop, a target at `rr` × the stop distance, risking
`riskPct` of the account, only inside these New York-time windows.

Condition kinds: `trend` (price vs an EMA), `emaStack` (fast vs slow EMA),
`rsi` (stretched), `formation` (W/M with stop hunt, from the MM scanner),
`emaTouch` (pullback to an EMA), `pattern` (one of the 21 candlestick
detectors), `nearLevel` (at the range low/high), `streak` (N candles against
the trade). Stops: `swing` (beyond recent extreme + buffer) or `percent`.

## Where rules come from

| File                           | Rules                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/rules/presets.ts`     | MM Confluence v2, EMA 50 pullback (both from `docs/strategies/mm-confluence-v2.md`), RSI range reversal (a plain baseline)                                                |
| `src/lib/rules/marvel.ts`      | MM stop hunt reversal, MM three-day exhaustion (course PDF), MFX level 3 peak reversal, MFX EMA 12/36 pullback (course videos); see `docs/strategies/marvel-fx-method.md` |
| localStorage `trade-hub-rules` | John's own copies (Duplicate on any card, then edit)                                                                                                                      |

Built-ins are read-only so their backtests stay comparable over time.

## What you can do with a rule

- **Check now**: loads the latest candles and shows a signal on the last 2 candles, with stop and target. **Place demo buy/sell** sends it to the demo account sized at the rule's risk %, after the plan checks.
- **Backtest / All N**: runs the rule over ~90 days (crypto) or ~1 year of daily forex, fees included, one trade at a time, and shows trades, win rate, profit factor, max drawdown and result per market.
- **Chart**: opens the market's detail page with every signal marked (BUY/SELL arrows) under the normal chart.

## How the backtest works (`backtest` in `src/lib/rules/engine.ts`)

- Indicators are computed once and read only up to the signal candle: no look-ahead (tested).
- Signal on candle i enters at candle i+1's open, using the signal's stop and target.
- A candle that touches both stop and target counts as a stop (conservative). Gaps through the stop fill at the open.
- Position size risks `riskPct`, capped at equity × leverage (1 for crypto, 30 for forex). Fees per side as in the demo account.
- Results in R (multiples of the risk) and as compounded equity from $10,000.

Read results with care: 90 days and a handful of trades is mostly noise. A
rule earns trust with many trades across many markets, and then in the demo
account.

## First results (2026-11-10, last 90 days, fees on)

| Rule                                | Trades | Total                                     |
| ----------------------------------- | ------ | ----------------------------------------- |
| MM Confluence v2 (4h, crypto)       | 1      | +1.8R (too few to mean anything)          |
| EMA 50 pullback (4h, 18 markets)    | 103    | -3.4R                                     |
| RSI range reversal (1h, 18 markets) | 489    | -409R (fees eat tight 1h stops on crypto) |

Lesson so far: on 1h crypto candles, a 0.1% fee per side is large next to a
tight stop. Prefer 4h/1d rules or wider stops.

## Course transcripts → rules

The 22 course videos are being transcribed on the Mac Mini (2026-11-10 night):

- Script: `scripts/transcribe-course.py` (tonight's run started from a /tmp copy; faster-whisper `small` from `~/.local/share/media-tools/.venv`, audio decoded with ffmpeg because that venv's PyAV is incompatible, the same bug that stopped the MacBook run).
- Output: `~/jvd-outputs/trading/transcripts/<folder> - <title>.txt` with `[mm:ss]` lines; progress in `_progress.md` there; tonight's log `/tmp/th-transcribe/log.txt`. It skips finished files, so re-running is safe:
  `~/.local/share/media-tools/.venv/bin/python -I scripts/transcribe-course.py ~/jvd-outputs/trading/MarketMakers ~/jvd-outputs/trading/transcripts`
- Speed: about real time ÷ 2 on the M4, so roughly 5 hours for all 21 videos.

When transcripts exist:

```bash
make extract-strategies            # or: scripts/extract-strategies ~/path/to/transcripts
```

It runs `claude -p` on the subscription (refuses to run if `ANTHROPIC_API_KEY`
is set) with `scripts/extract-strategies.prompt.md`, which updates
`docs/strategies/marvel-fx-method.md` and `src/lib/rules/marvel.ts` with
video + timestamp sources, in our own words, then runs the checks. It does not
commit. Review the diff, then run the new rules' backtests on `/strategies`.
