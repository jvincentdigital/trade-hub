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

## Results

Not run yet.
