# Ride the move: a trend strategy, tested before it is trusted

Started 2026-11-16. Play money and backtests only. No broker, no live race
state, nothing merged or deployed. Branch `lab/trend-ride`.

John, 2026-11-16: "you've been seeing the strategies are not working. Is it
timing? Is it just we need to get a better strategy? If that is, let's just
build one."

## Why this idea

Everything tested so far tries to catch a turn: Fib pullbacks, reversals,
tight intraday stops. The strategy lab (861 bots) and the Fib anchor study (42
versions) found no edge there after costs. The one thing that stayed above
zero in all three periods of the Fib study was going WITH the move when price
broke through, on the bigger charts. Trend following on daily candles is also
the best documented rule-based edge in currencies and gold, and it trades
rarely, so costs are a small share of each trade's risk. It matches what John
calls riding the big move.

## Plan, written before any result (pre-registration)

This section is committed before the first run. Results go below it.

### The rules

On closed candles, per market, one position at a time:

- **Buy** when a candle closes above the highest high of the N candles before
  it. **Sell** when it closes below the lowest low of the N before it. The
  trade opens at the next candle's open.
- **Stop**: 2 x ATR(20) from the fill. That distance is 1R.
- **Exit**: when a candle closes past the X-candle channel against the trade
  (a buy closes below the lowest low of the X candles before it), the trade
  closes at the next open. No profit target: winners run until the trend
  bends.
- After a trade ends, the next one needs a new breakout close.

### The four versions (all of them; nothing else is tried)

| Id       | Candles | N (breakout) | X (exit) |
| -------- | ------- | ------------ | -------- |
| D-20-10  | daily   | 20           | 10       |
| D-55-20  | daily   | 55           | 20       |
| H4-20-10 | 4-hour  | 20           | 10       |
| H4-55-20 | 4-hour  | 55           | 20       |

The numbers are the classic ones from the trend-following literature, picked
before looking, not searched for.

### Data and costs

`~/jvd-outputs/trading/history-majors`: Dukascopy BID 1-hour candles for
EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CHF, USD/CAD, NZD/USD and gold; 4-hour
and daily candles built on the New York close (`nyCloseBars`). Costs as in the
Fib anchor study: spread (wider at rollover and after a gap, `costMultAt`),
slippage on every fill, commission per side, overnight swap for every night
held (`swapCost`). Entries and exits fill at a candle open, which for daily
candles is the rollover hour, the most expensive minute of the day; that is
kept as the worst case.

### The split

| Period | Entry dates (UTC)        | Use                                                |
| ------ | ------------------------ | -------------------------------------------------- |
| P1     | 2021-04-01 to 2022-12-31 | design                                             |
| P2     | 2023-01-01 to 2024-11-10 | design                                             |
| P3     | 2024-11-11 to 2026-11-10 | design                                             |
| Exam   | 2019-04-01 to 2020-12-31 | sealed until now; run once with one frozen version |

The design phase loads candles from 2021-01-01 on. The idea itself came from
results on P1 to P3, so those three cannot prove it. The exam years were never
loaded by the Fib anchor study or the John's Method study (the first lab ran
its plain Fib bots there on four markets). The exam phase loads 2019-01-01 to
2021-03-31, scores entries from 2019-04-01 to 2020-12-31 and refuses to run a
second time.

### Luck test

For every trade, the opposite trade is also run from the same open with the
same stop distance and the mirrored exit. d = (real - mirrored) / 2. Trades in
8 markets overlap and five of them are dollar pairs, so trades are not
independent: d is summed per calendar month of entry and the test is on the
monthly sums (z = sum / sqrt(sum of squares), one-sided).

### Pass lines

- **Design gate**: a version goes to the exam only if its average R after
  costs is above 0 in each of P1, P2 and P3 with at least 30 trades in each.
  If several pass, the one with the highest worst-period average goes. If none
  pass, there is no exam and the exam years stay sealed.
- **Exam**: at least 60 trades, average R above 0, profit factor at least 1.2,
  luck p under 0.05, and a worst drop of at most 20% with 1% of the account
  risked per trade. All five, or it failed.

### What a pass would and would not mean

A pass earns a play-money account in the live race, nothing more. Trend
following wins on a minority of trades and can lose for months; a pass on two
exam years is evidence, not proof.

## Run it

```bash
./node_modules/.bin/tsx scripts/lab/trend-study.ts --phase design --out <dir>
./node_modules/.bin/tsx scripts/lab/trend-study.ts --phase exam --cell <id> --out <dir>   # once
```
