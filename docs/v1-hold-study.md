# John's London v1 with the hold rule the live account uses

Started 2026-11-17. Play money and backtests only. No broker, no live race
state, nothing merged or deployed. Branch `lab/v1-hold`.

Why: the end-of-day review of 2026-11-16 found that the live v1 account does
not run the rule that passed its test. The test closed every trade at 16:30
London. Since 2026-11-12 (PR #21, John: "we can just hold the trades") the
live account holds a trade until its stop or its target. In the test year 35
of 97 trades ended on that clock, and they carried +21.4R of the +27.6R. John,
2026-11-17, in a poll: "Test the hold rule first", then he decides between
keeping the hold and giving v1 its 16:30 close back.

## Plan, written before any result (pre-registration)

This section is committed and pushed before the hold option exists in the
code. Results go below it.

### The one version

John's London v1 exactly as frozen (`docs/london-v1-freeze.md`, k = 2,
b = 0.5, 15-minute candles), with the exits the live race has used since
2026-11-12 (`docs/strategy-race.md`, "2026-11-12: trades hold"):

1. No 16:30 London time exit. A trade ends at its stop, at its two targets
   (half at 0, the rest at -0.272), or at the open of the first 1-minute
   candle that is 30 minutes before the next red news for its currencies,
   whichever comes first. That news close is the backtest's existing rule; it
   now applies on any later day too. A trade still open when the data ends
   closes at the last price.
2. A market takes no new trade while one of its trades is still open, as in
   the live race (one open trade per market).
3. Entries are exactly as frozen: same signals, the 1.5R minimum, no chase,
   the "at least 90 minutes to 16:30 London or red news" gate, at most 2
   trades per market a day, and the account limits (5 open, one dollar bet, 2
   on a currency, 10% open risk, margin).

Nothing else is tried: no other exit, no other k or b, no trailing stop.

### Costs

Inside the London session the costs are the frozen ones. A held trade also
pays what the lab's cost model already charges for holding overnight
(`src/lib/lab/markets.ts`, used by the other lab studies):

- Financing at each weekday rollover (22:00 UTC, Wednesday counts three): the
  pound 1% a year on either side, gold 5% a year for a buy and 1% for a sell
  (`swapCost`). It is charged on the share of the trade still open.
- Wider spreads and slippage at the rollover (21:00 to 23:00 UTC, spread x4),
  late at night (23:00 to 01:00 UTC, x1.5) and on the first candle after a
  gap of 30 minutes or more, such as the weekend reopen (x8) (`costMultAt`).

Every number is reported twice: with these overnight costs (the main result,
closer to a real account) and without them (what the play-money race books:
it charges no financing and has no spread).

### Not modelled, and said so

- The live lone-wick rule on GBP/USD (a stop or target counts only when a
  close or the next candle confirms it). It exists because the live feed's
  book is thin; the test uses 1-minute broker-grade candles and a touch counts.
- The live check rhythm (every 15 minutes in the session, hourly outside it,
  so the live news close lands 15 to 90 minutes before the news). The test
  closes exactly 30 minutes before.
- The live feed itself (Kraken, and PAX Gold for gold). The test uses the
  frozen Dukascopy files.

### Data

The same files as the v1 freeze, checked against the SHA-256 values in the
freeze record before a candle is read: Dukascopy 1-minute BID candles for
GBP/USD and gold, and the red-news list. Two years, both already seen:

| Year   | Dates                    | Status                                            |
| ------ | ------------------------ | ------------------------------------------------- |
| Clean  | 2024-11-11 to 2025-11-10 | v1's settings were not chosen on it; seen 5 times |
| Design | 2025-11-11 to 2026-11-10 | chose v1's k and b                                |

Neither year is fresh, so nothing here is proof. The question it can answer
is narrower: on the same two years, does holding keep, improve or break what
the clock exit showed?

### The check that the runner is right

The frozen rule runs first through the same runner, with the hold option off.
It must reproduce the frozen numbers: design year 121 trades, +24.1R and the
trade list fingerprint `235d582d22978d5e`; clean year 97 trades, +27.6R. If it
does not, no hold number is reported.

### What is reported

For each year, the hold version next to the frozen one: trades, total R,
average R, share of winners, profit factor, what $10,000 became, the worst
drop, how each trade ended (stop, target, news, end of data), how long trades
were held and over how many nights, how many signals were passed because a
trade was still open, 1,000 coin-flip runs and the mirror test (both with the
same exits and costs), and v1's six lines as a description. Also the paired
view: what happened under the hold rule to the trades the clock used to close.

### What the result will mean (decided now)

One year of about 100 trades cannot tell two exits apart unless the gap is
large: the total of 100 trades moves by roughly 10R on luck alone. So the
lines below are wide on purpose, and they use the result with overnight costs.

- **Holding is fine:** in both years the hold version ends above $10,000, its
  total is no more than 5R below the frozen run, and its worst drop is no more
  than 5 points above the frozen run's. Then the recommendation to John is to
  keep the hold live, and to caption the scorecard with the hold numbers
  (marked "seen years, not proof").
- **Holding breaks it:** in either year the hold version loses money, or is
  more than 10R below the frozen run, or its worst drop passes 25%. Then the
  recommendation is to give live v1 its 16:30 London close back (John's word
  needed, it changes a live rule).
- **Anything between is "unclear".** Then the recommendation is to give v1
  its tested close back, because an untested exit should not be the one the
  forward test measures, and to let the older-years exam compare both exits.

Whatever the result, no live rule changes without John's word, and the hold
version gets no race account of its own from this study.

### What this study does not do

It does not open any unseen data. The exam of frozen v1 on older years
(2019 to 2024) is a separate plan.

## Run it

```bash
./node_modules/.bin/tsx scripts/lab/v1-hold.ts --history <dir with the 1-minute files> --out <dir>
```

## Results (run once, 2026-11-17)

Output: `~/jvd-outputs/2026-11-17/v1-hold-study/` (`results.txt`,
`results.json`, the trade lists). The price files matched the freeze record's
hashes. The frozen rule, run first through the same runner with the hold
option off, reproduced the frozen numbers exactly: design year 121 trades,
+24.1R, trade list fingerprint `235d582d22978d5e`; clean year 97 trades,
+27.6R (its fingerprint, recorded here for later checks: `2ebe12b9455690c4`).
A second run gave the same `results.json` byte for byte.

| Year   | Version                  | Trades | Total  | Avg R | Won | Profit factor | $10,000 became | Max drop | Mirror z | Six lines |
| ------ | ------------------------ | ------ | ------ | ----- | --- | ------------- | -------------- | -------- | -------- | --------- |
| Clean  | frozen (16:30 close)     | 97     | +27.6R | +0.28 | 58% | 1.76          | $16,896        | 9.6%     | 2.15     | pass      |
| Clean  | hold, overnight costs    | 93     | +24.8R | +0.27 | 49% | 1.57          | $15,894        | 12.6%    | 2.23     | pass      |
| Clean  | hold, no overnight costs | 93     | +25.4R | +0.27 | 51% | 1.59          | $16,071        | 12.4%    | 2.23     | pass      |
| Design | frozen (16:30 close)     | 121    | +24.1R | +0.20 | 50% | 1.44          | $15,508        | 13.7%    | 1.83     | pass      |
| Design | hold, overnight costs    | 120    | +22.2R | +0.18 | 45% | 1.34          | $14,794        | 11.6%    | 1.47     | pass      |
| Design | hold, no overnight costs | 120    | +25.4R | +0.21 | 46% | 1.39          | $15,767        | 11.6%    | 1.57     | pass      |

The six lines are a description here, not a verdict: both years were already
seen.

**The reading fixed in the plan: holding is fine.** With overnight costs, both
years end above $10,000, the totals are 2.7R (clean) and 1.9R (design) under
the frozen run, inside the 5R line, and the worst drop is 3.0 points higher in
the clean year and 2.1 points lower in the design year.

### How the trades ended

| Year   | Version               | Stop        | Final target | Clock (16:30) | Before red news |
| ------ | --------------------- | ----------- | ------------ | ------------- | --------------- |
| Clean  | frozen                | 35 (-33.8R) | 21 (+38.0R)  | 35 (+21.4R)   | 6 (+2.1R)       |
| Clean  | hold, overnight costs | 49 (-42.2R) | 33 (+60.7R)  | none          | 11 (+6.4R)      |
| Design | frozen                | 54 (-52.8R) | 25 (+48.1R)  | 38 (+26.0R)   | 4 (+2.8R)       |
| Design | hold, overnight costs | 71 (-63.4R) | 42 (+81.6R)  | none          | 7 (+4.0R)       |

The paired view, which answers the question that started this study: what
became of the trades the clock used to close?

- **Clean year:** 32 of those 35 trades were also taken under the hold rule.
  12 went on to the final target (+22.7R), 14 to the stop (-8.4R together,
  less than 1R each because many had banked the first target), 6 closed
  before red news (+4.0R). Together +18.3R, against +20.3R for the same 32
  trades on the clock.
- **Design year:** all 38 were also taken. 17 reached the final target
  (+33.5R), 18 the stop (-11.6R), 3 closed before news (+1.2R). Together
  +23.1R, against +26.0R on the clock.

So the profit does not come from the 16:30 close. Held, those trades split
into more full targets and more stops and kept most of what they made.

### What holding changes

- **Fewer winners, bigger ones.** The share of winning trades falls from 58%
  to 49% (clean) and from 50% to 45% (design). The live scorecard must not be
  read against the frozen "58% won".
- **Time in a trade.** Half the trades still end within about 3 hours. One in
  ten runs longer than 19 hours (clean) or 22 hours (design). The longest ran
  118 and 116 hours, over a weekend. 16 trades (clean) and 27 (design) stayed
  open over at least one night.
- **Trades not taken.** A held trade keeps its market busy: 48 signals were
  passed for that reason against 34 (clean), and 34 against 25 (design). Net,
  holding took 4 fewer trades in the clean year and 1 fewer in the design year.
- **Overnight costs** took 0.6R in the clean year and 3.2R in the design year,
  where more gold buys stayed open overnight. The play-money race does not
  charge them; a real account would.

### What this does and does not show

- On these two years the two exits cannot be told apart: the gaps (2 to 3R a
  year) are well inside what luck moves in a year of about 100 trades.
- It removes one worry: the tested profit did not depend on an exit the live
  account no longer has.
- It is not proof of anything. Both years were seen before, and holding was
  tested only after its frozen twin had passed on them. The exam on older
  years should score both exits, with the frozen one as the verdict.
- Not modelled: the live lone-wick rule, the live check rhythm, the live feed.

### What happens next

Per the plan, the recommendation to John is to keep the hold in the live
account, and to change the scorecard's yardstick from the frozen numbers to
the hold numbers of the test year (93 trades, 51% won, +0.27R a trade, worst
drop 12.4%, without overnight costs because the play-money race charges none),
captioned as a year the rule has already seen. That is a change to the live
app, so it waits for his word.
