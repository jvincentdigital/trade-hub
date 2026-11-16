# John's London v1 on the 30-minute chart

Started 2026-11-16. Play money and backtests only. No broker, no live race
state, nothing merged or deployed. Branch `lab/v1-30m`.

John, 2026-11-16: "My stop was from 15 minutes up, not from 5... 30 minutes is
fine also going forward." Then: "Just go ahead and test it."

## Plan, written before any result (pre-registration)

This section is committed before the first run. Results go below it.

### The one version

John's London v1 exactly as frozen (`docs/london-v1-freeze.md`, k = 2,
b = 0.5), with one change: the chart is 30-minute candles instead of
15-minute ones. Every count that v1 states in candles stays the same number
of candles (the move within 12 candles, a setup lives 24 candles, ATR 14, the
20-slot data check), so on the clock they last twice as long. Everything
stated in minutes or hours stays as it is (London 07:00 to 15:00, the 5-minute
entry wait, 90 minutes minimum life, news 30 minutes each side). Entries and
exits still walk the 1-minute candles. Costs, sizing and limits are v1's.

Nothing else is tried: no other chart size, no other k or b.

### Data

The same files as the v1 freeze: Dukascopy 1-minute BID candles for GBP/USD
and gold, 2024-11-11 to 2026-11-10, and the red-news list. On 2026-11-16 they
are on forge's archive drive (`/mnt/d/mac-mini-archive/jvd-outputs/trading/history-1m-24mo`)
and forge is off; Dukascopy's free download now answers "too many requests"
and points to a paid route, so the files cannot be fetched again for $0. The
run waits for forge. The files must match the SHA-256 values in the freeze
record before a candle is read.

### The check that the runner is right

The 15-minute chart is run first through the same runner. It must reproduce
the frozen numbers: design year 121 trades, +24.1R; clean year 97 trades,
+27.6R. If it does not, the 30-minute numbers are not reported as a result.

### The two years, and what they can show

| Year   | Dates                    | Status                                          |
| ------ | ------------------------ | ----------------------------------------------- |
| Clean  | 2024-11-11 to 2025-11-10 | v1's settings were not chosen on it; seen twice |
| Design | 2025-11-11 to 2026-11-10 | chose v1's k and b                              |

Neither year is fresh: v1 on 15 minutes has been scored on both. The
30-minute version is one fixed version, so nothing is picked on these years,
but a good result here is weaker evidence than v1's clean-year pass was.

### Pass lines

v1's six lines (`passLines`), on the clean year:

1. at least 80 trades
2. ends above $10,000 and averages at least +0.10R
3. profit factor at least 1.20
4. max drawdown at most 25%
5. total R above the 95th percentile of 1,000 coin-flip runs
6. mirror z at least 1.0

And the design year must end above $10,000. Under 80 trades on the clean year
is "no verdict", as in v1's spec; a 30-minute chart has half the candles, so
that outcome is likely and is reported as such, not bent.

### What a pass would and would not mean

A pass earns a play-money account in the live race next to v1 (John's yes
first). It does not replace v1 and it is not proof. No pass: v1 stays on 15
minutes and this study stops; no other chart sizes are tried after the fact.

## Run it

```bash
./node_modules/.bin/tsx scripts/lab/v1-30m.ts --history <dir with the 1-minute files> --out <dir>
```

## Results (run once, 2026-11-16)

Output: `~/jvd-outputs/2026-11-16/v1-30m-study/results.txt`. The files matched
the freeze record's hashes, and the 15-minute runs reproduced the frozen
numbers exactly, so the comparison stands.

| Chart  | Year   | Trades | Total  | Avg R | Won | Profit factor | $10,000 became | Max drop | Mirror z | Six lines |
| ------ | ------ | ------ | ------ | ----- | --- | ------------- | -------------- | -------- | -------- | --------- |
| 15 min | clean  | 97     | +27.6R | +0.28 | 58% | 1.76          | $16,896        | 9.6%     | 2.15     | pass      |
| 15 min | design | 121    | +24.1R | +0.20 | 50% | 1.44          | $15,508        | 13.7%    | 1.83     | pass      |
| 30 min | clean  | 80     | +5.5R  | +0.07 | 48% | 1.15          | $10,951        | 10.9%    | 0.73     | **fail**  |
| 30 min | design | 99     | +17.7R | +0.18 | 54% | 1.45          | $13,848        | 9.8%     | 1.89     | pass      |

**The 30-minute version did not pass.** On the clean year it made a little
money but failed three of the six lines: average +0.07R (needs +0.10R), profit
factor 1.15 (needs 1.20), mirror z 0.73 (needs 1.0). GBP/USD lost there
(44 trades, -3.5R); gold carried it (36 trades, +8.9R). The design year looked
fine (+17.7R), but that year does not count as proof.

On both years the 15-minute chart made more: +27.6R against +5.5R, and +24.1R
against +17.7R. v1 stays on 15 minutes. Per the plan, the study stops here and
no other chart size is tried.
