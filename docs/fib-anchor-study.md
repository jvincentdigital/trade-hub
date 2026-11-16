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

## Results (2026-11-16)

Design phase 17 s, final phase 3 s, each run once. Output:
`~/jvd-outputs/2026-11-16/trade-fib-study/` (`design.json`, `final.json`,
`REPORT.md` for John).

**No cell survived.** Four cells passed the tune and check lines; none beat
the luck test on the untouched period (lowest p of all 42 cells: 0.16; none
under 0.05, about 2 expected by luck).

- **Which anchor is his.** On the real candles, his two drawn sells sit on the
  same candle, the first big candle of the drop: its high in the USD/JPY
  screenshot (C = 163.738 exactly), its open in the recording (E = 1.34887
  against his 1.3488). The lab's rule (A) anchors on a bounce inside the drop
  (160.273 on USD/JPY). His USD/JPY buy only exists in the 12-candle window.
  Tests: `fibAnchors.test.ts`.
- **The anchor did not matter.** With his halves and his exits, all five
  anchors lost on the check period on all three chart pairs (average -0.15R
  to -0.72R a trade). On the untouched period two of fifteen were a hair above
  zero (C on H4>H1 +0.06R, A on D>H4 +0.04R), neither after losing on check.
- **Selling or buying the area lost.** Every reversal entry at anchor E
  (0.786, 0.886, halves, both exits) lost on check and on untouched, on every
  chart pair. On the 1-hour chart every cell lost in every period.
- **Waiting for two strong candles** (CONF2, 4-hour Fib): about +0.04R to
  +0.08R in tune and check, +0.03R (XJ) and -0.07R (X2R) untouched, luck p
  0.41 and 0.45. Flat.
- **Trading with the break** (CONT, daily Fib): positive in all three periods
  (XJ: +0.05R, +0.08R, +0.25R on 49, 41 and 48 trades; untouched profit
  factor 1.46, worst drop 20%, luck p 0.22). Too few trades to tell from luck.
  CONT on the 4-hour was -0.07R, +0.12R, +0.19R (untouched p 0.16); on the
  1-hour it lost. The earlier lab hint (the mirrored trade does better) points
  the same way but is still not proof.

Limits: 8 markets pooled, no 5 to 30 minute candles, no news list before
2024-11, no London or New York session rule, no "double down", no judgment
about which setups to skip. The untouched period is 21 months. The lab's plain
Fib bots had already run once on 2019 to 2024 for four of the markets.
2019-01 to 2020-12 was not loaded and is still closed.

Full table (R = average R a trade after costs; window/k = the chosen setting):

| Cell (chart, anchor, entry, exit) | Window/k | Tune n | Tune R | Tune PF | Check n | Check R | Check PF | Untouched n | Untouched R | PF   | Worst drop | Wins | Avg winner | Luck p | Passed check |
| --------------------------------- | -------- | ------ | ------ | ------- | ------- | ------- | -------- | ----------- | ----------- | ---- | ---------- | ---- | ---------- | ------ | ------------ |
| H4>H1 A HALVES XJ                 | 12/4.5   | 229    | -0.06  | 0.89    | 273     | -0.20   | 0.78     | 223         | -0.08       | 0.86 | 55%        | 26%  | 5.0%       | 0.80   |              |
| H4>H1 B HALVES XJ                 | 12/4.5   | 208    | +0.01  | 1.01    | 242     | -0.26   | 0.70     | 203         | -0.06       | 0.89 | 43%        | 28%  | 4.8%       | 0.78   |              |
| H4>H1 C HALVES XJ                 | 12/4.5   | 210    | -0.05  | 0.90    | 226     | -0.18   | 0.75     | 191         | +0.06       | 1.02 | 43%        | 28%  | 5.4%       | 0.58   |              |
| H4>H1 D HALVES XJ                 | 12/4.5   | 248    | -0.09  | 0.84    | 286     | -0.15   | 0.84     | 227         | -0.02       | 0.95 | 53%        | 26%  | 5.6%       | 0.65   |              |
| H4>H1 E HALVES XJ                 | 12/4.5   | 196    | -0.10  | 0.85    | 205     | -0.16   | 0.75     | 167         | -0.09       | 0.86 | 56%        | 26%  | 5.2%       | 0.84   |              |
| H4>H1 E R786 XJ                   | 12/4.5   | 196    | -0.11  | 0.86    | 206     | -0.15   | 0.76     | 167         | -0.08       | 0.87 | 56%        | 26%  | 5.4%       | 0.87   |              |
| H4>H1 E R786 X2R                  | 40/3     | 336    | +0.01  | 0.98    | 323     | -0.15   | 0.80     | 261         | -0.19       | 0.77 | 70%        | 28%  | 3.9%       | 0.77   |              |
| H4>H1 E R886 XJ                   | 12/4.5   | 151    | -0.13  | 0.82    | 166     | -0.23   | 0.67     | 135         | -0.06       | 0.87 | 56%        | 16%  | 10.9%      | 0.69   |              |
| H4>H1 E R886 X2R                  | 40/3     | 281    | +0.11  | 1.13    | 267     | -0.27   | 0.60     | 210         | -0.25       | 0.67 | 70%        | 26%  | 3.9%       | 0.85   |              |
| H4>H1 E HALVES X2R                | 40/3     | 335    | +0.03  | 1.01    | 320     | -0.17   | 0.76     | 258         | -0.25       | 0.69 | 75%        | 29%  | 3.3%       | 0.87   |              |
| H4>H1 E CONF2 XJ                  | 12/3     | 159    | +0.04  | 1.07    | 169     | +0.08   | 1.11     | 158         | +0.03       | 1.08 | 17%        | 49%  | 2.0%       | 0.41   | yes          |
| H4>H1 E CONF2 X2R                 | 12/3     | 159    | +0.05  | 1.04    | 169     | +0.08   | 1.11     | 158         | -0.07       | 0.88 | 30%        | 37%  | 2.9%       | 0.45   | yes          |
| H4>H1 E CONT XJ                   | 12/4.5   | 171    | -0.07  | 0.88    | 185     | +0.12   | 1.14     | 149         | +0.19       | 1.29 | 41%        | 34%  | 5.3%       | 0.16   |              |
| H4>H1 E CONT X2R                  | 12/4.5   | 171    | -0.08  | 0.87    | 185     | +0.06   | 1.06     | 149         | +0.00       | 0.97 | 40%        | 36%  | 3.7%       | 0.27   |              |
| D>H4 A HALVES XJ                  | 40/4.5   | 54     | -0.09  | 0.85    | 38      | -0.51   | 0.35     | 44          | +0.04       | 1.02 | 13%        | 35%  | 3.9%       | 0.50   |              |
| D>H4 B HALVES XJ                  | 40/4.5   | 41     | -0.24  | 0.60    | 33      | -0.71   | 0.19     | 41          | -0.09       | 0.82 | 18%        | 32%  | 3.4%       | 0.59   |              |
| D>H4 C HALVES XJ                  | 12/3     | 71     | +0.07  | 1.05    | 80      | -0.24   | 0.67     | 64          | -0.29       | 0.58 | 44%        | 24%  | 4.2%       | 0.73   |              |
| D>H4 D HALVES XJ                  | 40/4.5   | 40     | -0.11  | 0.77    | 32      | -0.52   | 0.32     | 38          | -0.11       | 0.80 | 18%        | 37%  | 2.9%       | 0.68   |              |
| D>H4 E HALVES XJ                  | 12/3     | 72     | +0.11  | 1.13    | 76      | -0.32   | 0.58     | 64          | -0.45       | 0.42 | 47%        | 21%  | 3.4%       | 0.76   |              |
| D>H4 E R786 XJ                    | 12/3     | 72     | +0.07  | 1.07    | 77      | -0.26   | 0.65     | 64          | -0.40       | 0.48 | 43%        | 21%  | 4.2%       | 0.80   |              |
| D>H4 E R786 X2R                   | 12/3     | 72     | +0.15  | 1.20    | 77      | -0.30   | 0.59     | 64          | -0.44       | 0.43 | 45%        | 22%  | 3.4%       | 0.91   |              |
| D>H4 E R886 XJ                    | 12/3     | 57     | +0.14  | 1.11    | 66      | -0.43   | 0.47     | 52          | -0.62       | 0.30 | 52%        | 12%  | 5.3%       | 0.43   |              |
| D>H4 E R886 X2R                   | 12/3     | 57     | -0.02  | 0.94    | 66      | -0.23   | 0.65     | 52          | -0.52       | 0.37 | 47%        | 17%  | 3.9%       | 0.87   |              |
| D>H4 E HALVES X2R                 | 12/3     | 72     | +0.21  | 1.29    | 76      | -0.33   | 0.55     | 64          | -0.47       | 0.39 | 47%        | 22%  | 2.9%       | 0.89   |              |
| D>H4 E CONF2 XJ                   | 40/3     | 29     | -0.12  | 0.77    | 25      | -0.45   | 0.34     | 28          | +0.04       | 1.06 | 6%         | 46%  | 2.1%       | 0.45   |              |
| D>H4 E CONF2 X2R                  | 40/3     | 29     | -0.10  | 0.81    | 25      | -0.34   | 0.50     | 28          | +0.05       | 1.08 | 7%         | 43%  | 2.3%       | 0.43   |              |
| D>H4 E CONT XJ                    | 40/3     | 49     | +0.05  | 1.07    | 41      | +0.08   | 1.14     | 48          | +0.25       | 1.46 | 20%        | 48%  | 3.2%       | 0.22   | yes          |
| D>H4 E CONT X2R                   | 40/3     | 49     | +0.01  | 1.00    | 41      | +0.29   | 1.54     | 48          | +0.21       | 1.38 | 20%        | 50%  | 2.8%       | 0.27   | yes          |
| H1 A HALVES XJ                    | 40/4.5   | 1214   | -0.11  | 0.81    | 1244    | -0.18   | 0.79     | 1141        | -0.19       | 0.71 | 99%        | 23%  | 5.6%       | 0.40   |              |
| H1 B HALVES XJ                    | 12/4.5   | 1128   | -0.13  | 0.81    | 1271    | -0.19   | 0.86     | 1140        | -0.22       | 0.78 | 100%       | 22%  | 5.7%       | 0.34   |              |
| H1 C HALVES XJ                    | 40/4.5   | 994    | -0.11  | 0.89    | 1020    | -0.22   | 0.71     | 924         | -0.14       | 0.79 | 94%        | 24%  | 5.4%       | 0.96   |              |
| H1 D HALVES XJ                    | 40/4.5   | 922    | -0.24  | 0.67    | 970     | -0.24   | 0.82     | 852         | -0.17       | 0.65 | 97%        | 22%  | 5.6%       | 0.99   |              |
| H1 E HALVES XJ                    | 40/4.5   | 1003   | -0.09  | 0.87    | 1042    | -0.18   | 0.82     | 941         | -0.15       | 0.76 | 97%        | 23%  | 5.5%       | 0.93   |              |
| H1 E R786 XJ                      | 40/4.5   | 1004   | -0.06  | 0.88    | 1041    | -0.16   | 0.83     | 944         | -0.15       | 0.77 | 96%        | 23%  | 5.8%       | 0.92   |              |
| H1 E R786 X2R                     | 40/4.5   | 1004   | -0.09  | 0.85    | 1041    | -0.22   | 0.74     | 944         | -0.13       | 0.80 | 95%        | 31%  | 4.0%       | 0.80   |              |
| H1 E R886 XJ                      | 40/4.5   | 813    | -0.18  | 0.80    | 876     | -0.23   | 0.79     | 769         | -0.20       | 0.67 | 98%        | 14%  | 10.7%      | 0.92   |              |
| H1 E R886 X2R                     | 40/4.5   | 813    | -0.16  | 0.76    | 876     | -0.27   | 0.67     | 769         | -0.16       | 0.75 | 95%        | 29%  | 4.0%       | 0.88   |              |
| H1 E HALVES X2R                   | 40/4.5   | 1003   | -0.10  | 0.85    | 1042    | -0.22   | 0.75     | 941         | -0.14       | 0.77 | 96%        | 31%  | 3.8%       | 0.80   |              |
| H1 E CONF2 XJ                     | 12/4.5   | 100    | -0.02  | 0.91    | 151     | -0.11   | 0.74     | 113         | -0.04       | 0.89 | 31%        | 57%  | 1.3%       | 0.26   |              |
| H1 E CONF2 X2R                    | 12/4.5   | 100    | -0.05  | 0.88    | 151     | -0.15   | 0.75     | 113         | -0.10       | 0.82 | 33%        | 36%  | 2.9%       | 0.23   |              |
| H1 E CONT XJ                      | 40/4.5   | 846    | -0.14  | 0.79    | 894     | -0.09   | 0.87     | 823         | -0.09       | 0.79 | 91%        | 25%  | 5.6%       | 0.31   |              |
| H1 E CONT X2R                     | 40/4.5   | 846    | -0.16  | 0.74    | 894     | -0.04   | 0.92     | 823         | -0.09       | 0.77 | 90%        | 33%  | 3.7%       | 0.35   |              |
