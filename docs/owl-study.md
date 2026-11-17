# What is worth taking from the Golden Owl

Started 2026-11-17. Play money and backtests only. No broker, no live race
state, nothing merged or deployed. Branch `lab/owl-idea`.

Why: John found his old trading robot, the Golden Owl EA (version 9, 2022,
for MetaTrader 4, in his iCloud Drive), and asked on 2026-11-17 to "take some
information from that and apply it to our" trading.

## What the Golden Owl is

Its file is compiled, so its code cannot be read, and no public source was
found. What follows comes from its own instruction sheets and from its 14
preset files.

- **Where and when:** gold (XAU/USD) on the 1-minute chart, in the Asian
  session only: Monday to Wednesday evenings, 6:00 PM to midnight Florida
  time. Away from US news. Switched on and off by hand; trades still open at
  the end are closed by hand.
- **How it trades:** a grid. It opens a small trade (0.02 lots on a $50,000
  account in the "passive" preset). When price moves 100 points ($1) against
  it, it adds a bigger trade (1.357 times the last, up to 0.5 lots), and
  again at every further $1. It takes its profit 100 points away. It runs two
  such "engines" at once. The "aggressive" preset multiplies by 4.
- **Its safety:** no stop on each trade in the passive preset. One account
  stop: when the account is down 4%, it closes everything and switches off.
  A "caution" level at 2%.
- **Its entry signal:** the presets name a 3-period high/low indicator and a
  34-period moving average. How they are combined is not knowable from the
  files.

So the Owl makes one bet: in quiet hours gold, having moved $1, usually comes
back $1 before it goes another $1. Everything else is money management: a
grid collects that bounce in small wins and pays for the nights without a
bounce in one large loss.

## Plan, written before any number was looked at (pre-registration)

This section is committed and pushed before any count or run. No statistic of
gold in these hours has been computed or seen yet. Results go below it.

### The question

Is there a bounce to collect? A grid cannot create an edge. If, after a $1
move, the next $1 is a coin flip, then any way of sizing the trades has the
same expectation: minus the costs. A grid only changes the shape, many small
wins and a rare large loss. So the bounce rate decides, and it can be counted
without any trading rule.

### Data

Gold 1-minute bid candles in UTC: the HistData file from the v1 exam
(2019-01-01 to 2025-12-31, SHA-256 `918b9c81...ed3bcbcf3`, the same prices as
the frozen Dukascopy file where they overlap), then the frozen Dukascopy file
for 2026-01-01 to 2026-11-10. About 7.9 years. These candles were used once
for v1's exam in London hours; nothing has ever been run or counted on them
in the Owl's hours.

An evening sits out when fewer than 90% of its 355 minutes are present (the
thin days of 2023).

### The Owl's hours

Monday, Tuesday and Wednesday evenings, 18:05 to 24:00 New York time (Florida
is on New York time; gold reopens at 18:00, and the first five minutes are
left out because spreads are at their widest). Everything is flat at 24:00.

### Part 1: the bounce count (no money, no rule)

Each evening a ladder of $1 levels is laid from the evening's first price.
Every time price first reaches the next level up or down, that is a step.
For each step after the first, it is a **bounce** if it goes back the way it
came and an **onward** step if it continues. Inside a 1-minute candle the
path is taken as open, low, high, close for a candle that closed up and open,
high, low, close for one that closed down.

Bounce rate = bounces / (bounces + onward steps), per year and overall, with
its margin of error.

For comparison, the same count on: Thursday and Friday evenings (same clock
hours), and London hours (07:00 to 16:30 London) on all weekdays.

What a fade needs: trading against a $1 step with a $1 target and a $1 stop
makes (2 x rate - 1) dollars per ounce before costs. With a round-trip cost
of c dollars per ounce the rate must be above (1 + c) / 2.

Two cost levels, fixed now:

| Cost level                          | Round trip per ounce | Bounce rate needed |
| ----------------------------------- | -------------------- | ------------------ |
| Best case (raw-spread account)      | $0.20                | 60.0%              |
| Typical retail in the Asian session | $0.35                | 67.5%              |

### Part 2: a grid with the Owl's passive numbers (an illustration, labelled ours)

This is our own simple reading of the passive preset, not the Owl itself. On
a $50,000 play account, each evening:

- A buy side and a sell side run at once. Each opens a first trade of 0.02
  lots (2 ounces) at the evening's first price.
- A side adds a trade each time price moves a further $1 against its last
  trade, each 1.357 times the last, at most 0.5 lots.
- A side closes all its trades when price is $1 better than its average entry
  price, then starts again at once with 0.02 lots.
- Costs are charged per ounce on every closed trade, at both cost levels.
- **Account stop:** when the evening's result, open trades included, reaches
  minus 4% of the balance, everything closes and the evening is over.
  **Caution:** while the evening is down 2% or more, a side that closes does
  not start again.
- At 24:00 New York everything still open is closed at the price.

Reported per year, at both cost levels: evenings traded, evenings that ended
up, the average up evening, evenings that hit the 4% stop, the year's result
in dollars and percent, and the worst drop.

The presets were written between March and May 2022, so the years from June
2022 on are the fair part of this picture, and they are shown separately.

### What the result will mean (decided now)

- **No bounce edge:** the bounce rate in the Owl's hours is under 60% in at
  least 5 of the 8 years. Then a grid there earns its small wins by carrying
  risk, not from an edge. Recommendation: no Owl-style account, and nothing
  taken from its entries or its grid.
- **A bounce worth a play account:** the bounce rate is 60% or more in at
  least 6 of the 8 years, and the grid illustration ends above its start at
  both cost levels over June 2022 to November 2026. Then the recommendation
  is to propose one play-money account built on the idea, on John's yes.
- **Anything between:** unclear. No build; the numbers are reported as they
  are.

### What can be borrowed without a test

These are risk rules, not edges, and they cost nothing to copy if John wants
them for his own calls or for any play account: a daily loss limit that stops
trading for the day, a daily goal after which trading stops, and staying out
around red news.

### Not included

Running the real Owl file (it needs MetaTrader 4 on Windows and a broker demo
account John opens himself), and any change to John's London v1.

## Run it

```bash
./node_modules/.bin/tsx scripts/lab/owl-study.ts --hist <histdata dir> --frozen <frozen 1-minute dir> --out <dir>
```

## Results (2026-11-17)

Output: `~/jvd-outputs/2026-11-17/owl-study/` (`results.txt`, `results.json`;
the first run's output is kept as `results-run1-flawed.txt`). 2,738,472
1-minute gold candles, 2019-01-01 to 2026-11-10.

**The reading fixed in the plan: no bounce edge.** In all 8 years the bounce
rate in the Owl's hours is under the 60% a fade needs at the best cost.

### Two faults of the study itself, found after the first run and fixed

Both are faults of this test, not of the Owl, and neither touches the
pre-registered count or its reading.

1. **The grid illustration jumped its own stop.** It checked the 4% account
   stop only four times a minute, so a fast candle carried losses far past it
   (evenings of -$19,886 on a stop of -$2,000), and it went on "trading" an
   account that was already wiped out. The grid now walks every price move in
   steps of 10 cents, and a run ends when the account is under a tenth of its
   start. The numbers below are from the corrected run.
2. **1-minute candles are too coarse for $1 steps when gold moves fast.** In
   2025 half of the steps, and in 2026 three quarters, came several to one
   price move inside a single candle, where a bounce in between cannot be
   seen. So the count now also shows that share, and an upper bound that
   counts only the first step of each move. The upper bound is generous: it
   drops the fast one-way runs.

A count written separately in Python reproduces Part 1 exactly (same
evenings, steps and rates for 2019 to 2025).

### Part 1: the bounce count in the Owl's hours

Monday to Wednesday evenings, 18:05 to 24:00 New York. 1,157 evenings
counted, 73 sat out (thin data in 2023, holidays).

| Year | Evenings | $1 steps an evening | Bounce rate               | Too fast for 1-minute candles | Upper bound |
| ---- | -------- | ------------------- | ------------------------- | ----------------------------- | ----------- |
| 2019 | 154      | 14                  | 47.1% (plus or minus 2.2) | 16% of steps                  | 52.6%       |
| 2020 | 156      | 72                  | 44.8% (0.9)               | 31%                           | 55.7%       |
| 2021 | 155      | 26                  | 48.5% (1.6)               | 7%                            | 50.4%       |
| 2022 | 156      | 29                  | 49.0% (1.5)               | 9%                            | 51.8%       |
| 2023 | 94       | 21                  | 48.9% (2.3)               | 4%                            | 50.2%       |
| 2024 | 155      | 56                  | 47.6% (1.1)               | 17%                           | 53.0%       |
| 2025 | 154      | 271                 | 40.0% (0.5)               | 50%                           | 58.0%       |
| 2026 | 133      | 780                 | 30.6% (0.3)               | 74%                           | 63.7%       |

Needed to pay the costs: over 60.0% at the best cost, over 67.5% at the
typical cost.

- **Where the candles can see it, the next dollar is a coin flip.** In 2021,
  2022 and 2023 fewer than one step in ten is too fast, and the bounce rate
  is 48.5% to 49.0%, with an upper bound of 50% to 52%.
- **From 2019 to 2024 even the generous upper bound is under 60%.** That is
  six years out of eight, more than the five the plan asked for.
- **2025 and 2026 cannot be measured this way.** Gold moved from about $2,600
  to over $4,000, so a $1 step went from a real move to noise: 271 and 780
  steps an evening. The true rate is somewhere between the count and the
  upper bound. Nothing shows it clears the bar, and a 100-point grid written
  for gold near $1,900 is far too tight for gold at $4,000.
- **The Owl's hours are not special.** Thursday evenings give 46% to 51%
  through 2024 (Friday evenings have no market and sat out), and London hours
  give 44% to 47%. The Asian session does not bounce more than the rest.

### Part 2: a grid with the Owl's passive numbers (our reading, an illustration)

$50,000 play account. "Ended up" is the share of evenings that closed with a
gain.

Best cost ($0.20 a round trip), all years:

| Year | Evenings | Ended up | Average up evening | Hit the 4% stop | Year              |
| ---- | -------- | -------- | ------------------ | --------------- | ----------------- |
| 2019 | 154      | 77       | +$57               | 2               | -$1,320 (-2.6%)   |
| 2020 | 156      | 120      | +$255              | 13              | -$2,755 (-5.7%)   |
| 2021 | 155      | 112      | +$72               | 1               | +$732 (+1.6%)     |
| 2022 | 156      | 107      | +$73               | 8               | -$11,913 (-25.5%) |
| 2023 | 94       | 59       | +$62               | 3               | -$3,343 (-9.6%)   |
| 2024 | 155      | 105      | +$162              | 26              | -$12,707 (-40.5%) |
| 2025 | 65       | 22       | +$250              | 40              | -$13,722 (-73.4%) |

The account was under a tenth of its start before 2025-06-03, and the run
ended there.

| Run                             | $50,000 became | When the run ended     |
| ------------------------------- | -------------- | ---------------------- |
| Best cost, all years            | $4,971         | wiped out by June 2025 |
| Best cost, June 2022 on         | $4,920         | wiped out by July 2025 |
| Typical cost ($0.35), all years | $4,946         | wiped out by Nov 2024  |
| Typical cost, June 2022 on      | $4,899         | wiped out by May 2025  |

From June 2022 on, the part after the presets were written, the best-cost run
made -11.1% (rest of 2022), -10.0% (2023), -37.7% (2024) and -80.3% (2025
until it ended).

What the picture shows is the shape the plan predicted. Most evenings end up:
about seven in ten from 2020 to 2024. A handful of evenings a year hit the 4%
stop, and each of those takes back the gains of ten to thirty winning
evenings. It
lost in six of the seven years it ran, and only 2021, the calmest year with
one stop, ended slightly up.

Limits of this illustration, said plainly:

- It is our reading of the preset files, not the Owl. Both sides start at the
  first minute and restart at once; the real robot uses an entry signal we
  cannot read, and its user switches it off around news and may stop after a
  daily goal.
- A real user would have changed the lot and grid numbers as gold doubled.
  The 2022 numbers on 2025 gold are not what anyone would run.
- Inside a fast candle the test sees one straight move, so 2025 is the least
  reliable year. The years 2019 to 2024 are the fair part.

None of these limits can create an edge that the bounce count does not show.
They change how fast and how smoothly the result arrives.

### What is worth taking

- **Not its entries and not its grid.** There is no bounce to collect, so a
  grid on gold in these hours is paid for carrying risk: steady small wins
  and a rare loss that is larger than all of them.
- **Its risk rules are sound and cost nothing:** a daily loss limit that ends
  the day, a daily goal after which trading stops, staying out around red
  news. They do not make a losing rule win, but they are the right habits for
  John's own calls and for any play account.
- **One real lesson:** the Owl feels like it works because it wins about two
  evenings in three. Winning often is not the same as making money. Any
  robot or method should be judged on its worst nights and on years of
  history, never on a good month.

By the plan there is no Owl-style account and no further test. What stays
possible, if John wants it one day, is running the real file in MetaTrader on
a demo account he opens; this study gives no reason to expect a different
answer.
