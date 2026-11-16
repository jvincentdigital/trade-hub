# John's Fib anchor study

Started 2026-11-16. Play money and backtests only. No broker, no live race
state, nothing merged or deployed. Branch `lab/fib-anchor-study`, draft PR
against `feat/strategy-lab`.

Question: the lab's Fib bot may not anchor "1" where John really draws it.
Does any reading of his anchor, with his entry area, beat luck after costs?

Run it (offline, about a minute):

```bash
LAB_HISTORY=~/jvd-outputs/trading/history-majors \
  ./node_modules/.bin/tsx scripts/lab/fib-anchor-study.ts --phase design --out <dir>
./node_modules/.bin/tsx scripts/lab/fib-anchor-study.ts --phase final --out <dir>   # once; refuses a second time
```

## Plan, written before any result (pre-registration)

This section was committed before the first run. Results are added below it.

### What earlier studies already looked at

- 2024-11-11 to 2026-11-10: used by the strategy lab (all of it), by John's
  London v1 (clean year, then design year) and by the John's Method study of
  2026-11-12 (18 versions, 8 markets, the same data folder). Nothing in it is
  fresh. It is this study's **tune** period.
- 2019-01 to 2024-11-10: the John's Method study kept these "exam years"
  closed and never scored them. The lab ran its plain Fib bots there once
  (EUR/USD, GBP/USD, USD/JPY, gold; they lost). So they are almost fresh.
- The task brief suggested tuning on 2019 to 2022 and keeping 2025 to 2026
  untouched. That is not possible honestly: 2025 to 2026 is the most looked-at
  stretch. The split is turned around instead.

### The split (fixed now)

| Period    | Dates (entry time, UTC)  | Use                                                   |
| --------- | ------------------------ | ----------------------------------------------------- |
| Tune      | 2024-11-11 to 2026-11-10 | choose each cell's 4 settings; already seen by others |
| Check     | 2023-01-01 to 2024-11-10 | first look at old data; gate for "survivor"           |
| Untouched | 2021-04-01 to 2022-12-31 | run once at the very end with frozen settings         |
| Sealed    | 2019-01-01 to 2020-12-31 | never loaded by this study; kept for a future exam    |

The design phase loads candles from 2022-10-01 on (three months of warm-up for
the averages, no trade scored before 2023). The final phase loads 2021-01-01
to 2023-01-31 and refuses to run twice. No candle before 2021 is read.

### Data

`~/jvd-outputs/trading/history-majors`: Dukascopy BID 1-hour candles for
EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CHF, USD/CAD, NZD/USD and gold (all 8
are on disk). 4-hour and daily candles are built from 1h on the New York close
(`nyCloseBars`), as the lab does. No news list exists before 2024-11, so the
news filter and news spreads are off in every period.

### The method under test, in John's terms

Mark the move on the bigger chart, draw the Fib from where the move started
(1) to where it ended (0), wait for the pullback into the 0.786 to 0.886 area,
enter there, stop past 1 "with a good margin". Three chart pairs:

- `H4>H1`: Fib on the 4-hour, entries read on the 1-hour (his recording). Held at most 10 days.
- `D>H4`: Fib on the daily, entries on the 4-hour (his EUR/USD drawing). Held at most 30 days.
- `H1`: Fib and entries on the 1-hour (the smallest chart this data has). Held at most 5 days.

### Anchors for "1" (sell wording; buys mirror)

A setup starts when a closed Fib-chart candle makes the lowest low of the
window; 0 is that low and follows new lows until the first entry. Same for all.

- **A** the lab's rule: high of the most recent up candle no later up candle tops.
- **B** high of the last up candle before the first big candle of the drop.
- **C** high of the first big candle of the drop (his USD/JPY screenshot, 163.738).
- **D** the swing high of the window.
- **E** the OPEN of the first big candle of the drop (his recording: 1.3488 on
  GBP/USD, not the 1.3505 wick). **Primary: this is what he drew most recently.**

"First big candle" = first down candle at or after the swing high with a body
of at least 0.75 ATR(14). The 0.75 was set from his two drawn sells only
(candle shapes, no results): it picks his candle in both.

### Entries (at anchor E), exits

- **R786**, **R886**: all at once, resting order at that level.
- **HALVES**: equal size at 0.786 and at 0.886 ("0.05 here and 0.05 here"), one stop. Full 2% risk only if both fill.
- **CONF2**: after price reaches 0.786, two strong candles in a row his way (body at least 0.5 ATR each), enter at the next open.
- **CONT**: a candle closes beyond 0.786, trade with that move at the next open (against his trade). Stop the same distance his 0.786 trade would have had.
- Exit **XJ**: stop 0.25 ATR past 1, half off at 0, the rest at -0.272 (CONT: same distances mirrored).
- Exit **X2R**: same stop, everything off at 2R (inside his 1.5R to 2.5R goal).

Not tested: his "double down" add (the 2026-11-12 study found it fired on few
trades and did not help), "let it ride" with no target (no rule), his reading
of the news and of which setups to skip.

### The grid: 42 cells

- Anchor question: 5 anchors x 3 chart pairs, entry HALVES, exit XJ = 15 cells.
- Entry question: anchor E, 5 entries x 2 exits x 3 chart pairs = 30 cells (3 shared with the first group).

Each cell chooses one of 4 settings on the tune period only: window 12 candles
(setup lives 24) or 40 (lives 60), and move size k = 3 or 4.5 ATR. Rule: the
most total R among settings with at least 40 tune trades.

### Costs and scoring

- The lab's engine and cost model: spread on BID data, slippage on market
  fills, spread x4 at rollover, x8 on the first candle after a gap (Sunday
  reopen, gold's daily halt), swap per night held, commission. Costs for the
  four markets the lab did not have (AUD/USD, USD/CHF, USD/CAD, NZD/USD) are
  typical retail numbers, written in the script.
- All 8 markets pooled; every signal counts once ("each on its own").
- Reported per cell and period: trades, average R after costs, profit factor,
  worst drop, win rate, average winner in % of the account at 2% risk (one
  $10,000 play account, at most 5 trades open).
- Luck test: every signal is also traded the other way at the same moment
  (the lab's random-direction test, exits from the next candle for both).
  Signals of the same week are summed first, because 8 dollar markets move
  together. One-sided p.
- Many tries: Holm correction over all 42 cells; about 2 cells under p 0.05
  are expected by luck alone.

### What counts as surviving (fixed now)

1. Tune: at least 40 trades and average R above 0.
2. Check: at least 40 trades, average R above 0, profit factor above 1.
3. Untouched (run once): at least 40 trades, average R above 0, profit factor
   above 1, and luck-test p under 0.05 after Holm over the cells that reached
   this step.

A cell that fails any line is "not shown to beat luck". The untouched numbers
of all 42 cells are still printed, for the record; they choose nothing.
