# Three confirmations: the strategies merged into one

Started 2026-11-16. Play money and backtests only. No broker, no live race
state, nothing merged or deployed. Branch `lab/confluence`, on top of
`lab/fib-anchor-study`.

John, 2026-11-16: "I want you to incorporate all these strategies we have
found and merge them into one. For us to take a trade that we know is gonna
make us money, we need like three confirmations, that being like, the MA is
crossed, the Fibonacci is touched here, so this is gonna be a bounce back
level, and this is where we put our position."

Question: does asking for more confirmations turn John's Fib into a trade that
makes money after costs? And does each confirmation add anything?

## Plan, written before any result (pre-registration)

This section is committed before the first run. Results go below it.

### The three confirmations (a SELL; a BUY is the mirror)

1. **Level, the Fib.** A drop of at least 3 ATRs within 12 candles of the Fib
   chart. 1 = the open of the first big candle of the drop (anchor E, John's
   recording), 0 = the low. Price climbs back to 0.786. The setup lives 24 Fib
   chart candles and dies if price trades past 1. Same code as the Fib anchor
   study (`planFib`, settings bars 12, expiry 24, k 3; no setting is tuned
   here).
2. **Trend, the MA.** On the Fib chart, at the last candle closed before the
   entry, EMA 12 is under EMA 36 (above for a buy). 12 and 36 are the course's
   pair. The trade is with the trend: it sells a climb back inside a
   downtrend.
3. **Bounce, the candle.** After price reached 0.786, two strong candles in a
   row in the trade's direction on the entry chart (each closes John's way
   with a body of at least half an ATR), without trading past 1. This is the
   Fib study's CONF2, John's "after two strong candles".

Entry: with the bounce, at the next candle's open. Without it, a resting order
at 0.786, all at once. Stop: a quarter ATR past 1. Exits: half off at 0, the
rest at -0.272 (John's exits). One trade per setup.

### The versions

Four nested versions on each of the Fib study's three chart pairs (Fib on the
4-hour with 1-hour entries, Fib on the daily with 4-hour entries, 1-hour
alone): 12 cells.

| Version | Level | Trend | Bounce | Entry                  |
| ------- | ----- | ----- | ------ | ---------------------- |
| F       | yes   |       |        | resting order at 0.786 |
| FT      | yes   | yes   |        | resting order at 0.786 |
| FC      | yes   |       | yes    | next open after bounce |
| FTC     | yes   | yes   | yes    | next open after bounce |

Two side cells, reported but never sent to the exam: FTC with EMA 50 over EMA
200 as the trend (the classic pair) on the two chart pairs where 200 candles
can warm up without touching the sealed years (4-hour Fib and 1-hour alone).
A daily EMA 200 would need 2020 candles, so it is not run.

Nothing else is tried: no other levels, patterns, exits or settings.

### Data and costs

`~/jvd-outputs/trading/history-majors`, 8 markets (EUR/USD, GBP/USD, USD/JPY,
AUD/USD, USD/CHF, USD/CAD, NZD/USD, gold), Dukascopy BID 1-hour candles,
4-hour and daily built on the New York close. Costs exactly as in the Fib
anchor study (the lab engine `simulate`: spread by time of day, slippage,
commission, overnight swap). No news list before 2024-11, so news is off.

### The split

| Period | Entry dates (UTC)        | Use                                                 |
| ------ | ------------------------ | --------------------------------------------------- |
| P1     | 2021-04-01 to 2022-12-31 | design (the Fib study's untouched period, now seen) |
| P2     | 2023-01-01 to 2024-11-10 | design (its check period)                           |
| P3     | 2024-11-11 to 2026-11-10 | design (its tune period)                            |
| Exam   | 2019-04-01 to 2020-12-31 | sealed; run once with one frozen version, if earned |

The design phase loads candles from 2021-01-01. All three design periods were
already looked at by earlier studies (the Fib study scored F and FC there with
tuned settings), so they prove nothing. The exam years are still sealed: the
Fib anchor study and the trend study (PR #28) never loaded them. The exam
phase loads 2019-01-01 to 2021-03-31, scores entries from 2019-04-01 to
2020-12-31 and refuses to run twice.

### Luck test

Each trade is also run mirrored (the opposite side from the same price, stop
and targets mirrored), both under the engine's `limitFromNext` rule as in the
Fib study. d = (real - mirrored) / 2, summed per calendar month of entry; z =
sum / sqrt(sum of squares) over the months, one-sided.

### Pass lines

- **Design gate** (FT, FC or FTC only; side cells never): average R after
  costs above 0 in each of P1, P2 and P3 with at least 30 trades in each, AND
  a higher average R over the whole design span than the F version on the same
  chart pair. If several pass, the one with the highest worst-period average
  goes. If none pass, there is no exam and the years stay sealed.
- **Exam**: at least 60 trades, average R above 0, profit factor at least 1.2,
  luck p under 0.05, worst drop at most 20% with 1% of the account risked per
  trade. All five, or it failed.

### Account numbers

R is what a trade risks. The account curve adds 1% of the starting balance
times R at each trade's exit, every trade taken; "worst drop" is the biggest
fall of that curve from a high, as a share of the start.

## Run it

```bash
./node_modules/.bin/tsx scripts/lab/confluence-study.ts --phase design --out <dir>
./node_modules/.bin/tsx scripts/lab/confluence-study.ts --phase exam --cell <id> --out <dir>   # once
```
