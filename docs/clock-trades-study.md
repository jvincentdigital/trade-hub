# Three clock trades: plan

Lab study, play money only. **Plan written 2026-11-17 before any result of
this study was computed.** The price files were being downloaded while it was
written; none had been opened. Results go at the bottom; the plan above them
is not edited.

## Why

`docs/strategy-search.md`: after everything else failed, a search of the
published evidence left three small effects worth one cheap test each. All
three are trades at fixed clock times. Their rules come from the papers, not
from our data, so there is nothing to tune and no choosing step: each rule is
written down here and run once.

## Data

Free 1-minute files from HistData (Bid quotes), converted with the clock rule
found in the v1 exam (New York winter time plus the European summer hour):

- EUR/USD 2005 to 2025 (never used in this lab)
- gold 2009 to 2025 (2019 to 2025 were used by the Owl studies, never for a
  clock rule; 2009 to 2018 never opened)
- S&P 500 index quotes (SPX/USD) 2010 to 2025 (never used)

Before any test, each file's clock is checked without looking at returns: the
weekly gap must sit between Friday 17:00 and Sunday 17:00 to 18:05 New York
time in every year. A file that fails is not used.

## How a trade is measured

- New York time, with US daylight saving.
- A trade at clock time T is made at the open of the first 1-minute candle
  stamped at or after T, if that candle is stamped within 5 minutes of T.
  Otherwise that leg is skipped for the day.
- A leg's result in basis points (hundredths of a percent) is 10,000 times
  (exit price / entry price - 1), with the sign turned for a short, minus the
  leg's cost.
- Cost of one leg, in and out: EUR/USD 1.0 basis point (0.8 spread, 0.2
  slippage), gold 2.0, S&P 500 1.5. Every test is also run at double cost.
- A day's result is the sum of its legs. Days are Monday to Friday.

## The three rules

**Test 1, EUR/USD local hours** (Breedon and Ranaldo 2013, in the hours used
by the 2019 re-run): short from 03:00 to 11:00, then long from 11:00 to
16:00. Flat by 16:00, so no overnight financing.

**Test 2, gold night and day** (Blose and Gondhalekar 2014, 2018: gold gains
outside the New York day session and loses inside it): long from 18:05 to
08:20 the next morning (Sunday to Thursday evenings), and short from 08:20 to
13:30 (Monday to Friday). Nothing is open at the 17:00 rollover, so no
financing. The day belongs to the date of the 08:20 moment.

**Test 3, the index's last half-hour** (Gao, Han, Li, Zhou 2018): the signal
is the move from the previous trading day's 16:00 price to today's 15:30
price. Up: long from 15:30 to 16:00. Down: short. Flat at 16:00.

For tests 1 and 2 each leg is also reported alone.

## What luck looks like

- **Random clocks (tests 1 and 2).** 1,000 made-up strategies with the same
  number of legs and the same leg lengths, each leg at a random start time on
  a 5-minute mark inside the same daily span (test 1: 00:00 to 17:00; test 2:
  18:05 to 17:00 the next day), each with a random direction kept for the
  whole sample, same costs. Seed 1.
- **Shuffled signals (test 3).** 1,000 runs with the same days and the same
  number of long and short days, in random order. Also shown: always long
  and always short for that half-hour.

## Reading fixed now

Periods: early (start to 2012), middle (2013 to 2018), recent (2019 to 2025).
The t-statistic is the average daily result divided by its standard error.

A test **passes** when all five hold, after costs:

1. Recent period: the average daily result is above zero with t of 2 or more.
2. Whole period: t of 3 or more. (Three rules are tried, on top of everything
   tried before; a bar of 2 is too easy.)
3. Whole period: the average daily result is above the 95th percentile of
   its luck runs.
4. At least 5 of the 7 years 2019 to 2025 end above zero.
5. At double cost the recent period's average is still above zero.

- **"Worth a play account"**: passes. Before John is told so, a second
  implementation written by someone who has not seen ours must agree, and two
  reviewers must fail to break it.
- **"Real but too small to trade"**: before costs it clears 1, 2 and 3, but
  after costs it does not pass.
- **"Not there"**: anything else.

## Limits, said in advance

- One free price feed with Bid quotes only; costs are assumed constant. Real
  spreads are wider at 03:00 and at the 18:05 reopen.
- SPX/USD is a broker-style index quote, not the futures or the fund the
  papers used.
- These are small effects. A pass at 1 to 2 basis points a day is roughly
  2.5% to 5% a year on the money exposed, before any leverage.
- The gold years 2019 to 2025 are not blind in the strict sense: the Owl
  study printed gold's average evening drift for those years.
- Play money only. No broker is connected. This is not financial advice.

## Amendment 1: the clock (2026-11-17, before any return was computed)

The planned clock check failed on all three files, and it showed why. In 2007
to 2018, in the three or four weeks a year when the United States and Europe
change their clocks on different dates, the converted files were one hour
late: candles stamped after Friday 17:00 New York and a weekly reopen an hour
late. From 2019 on no week was affected. The check's own pass line (90% of a
year's weekends inside a window) also counted thin weeks and holidays as
failures, which is not what it is for.

**Repair, from the stamps alone (no price was read).** A week with a candle
after Friday 17:00 New York is moved one hour earlier. A week that starts
before the Sunday reopen (17:00 for EUR/USD, 18:00 for gold and the index) is
moved one hour later. A week that one hour cannot explain is left out.

| File    | Weeks moved earlier | Moved later | Left out |
| ------- | ------------------- | ----------- | -------- |
| EUR/USD | 41 (2007 to 2018)   | 1 (2006)    | 1 (2005) |
| Gold    | 29 (2009 to 2018)   | 0           | 5 (2009) |
| S&P 500 | 25 (2011 to 2018)   | 0           | 1 (2011) |

**New pass line for the clock check:** no week has a candle while the market
is shut. All three repaired files pass. Thin weeks stay in; the 5-minute rule
skips the trades they cannot price.

Known gap: in 2023 the free files are thin at the edges of many weeks. A week
that is both thin and an hour off could not be seen by this check.

Repaired files (sha256, first 16 characters): EUR/USD fdd9fe3c46956539, gold
2ee908c82589366e, S&P 500 6722951418d34fcb. Everything else in the plan is
unchanged.

## Results (2026-11-17)

Run once on the repaired files. Output:
`~/jvd-outputs/2026-11-17/clock-trades/`. Script at commit `5b83ff4`.

**None of the three passes.** Each fails in its own way. Numbers are basis
points a day (a basis point is a hundredth of a percent), with the
t-statistic in brackets.

| Test                                   | Before costs, all years | Before costs, 2019 to 2025 | After costs, 2019 to 2025 | Years up, of 7 | Reading   |
| -------------------------------------- | ----------------------- | -------------------------- | ------------------------- | -------------- | --------- |
| 1. EUR/USD local hours (2005 to 2025)  | +3.25 (4.8)             | +0.26 (0.3)                | -1.71 (-1.8)              | 3              | not there |
| 2. Gold night and day (2009 to 2025)   | +2.61 (1.9)             | +5.06 (2.4)                | +1.13 (0.5)               | 4              | not there |
| 3. Index last half-hour (2010 to 2025) | +1.08 (2.2)             | +0.98 (1.1)                | -0.52 (-0.6)              | 3              | not there |

- **Test 1 was real and is gone.** Before costs it made +5.3 a day in 2005 to
  2012 and +3.9 in 2013 to 2018, as the papers said, and +0.3 in 2019 to 2025.
  Its last good years were 2015 and 2016. After 1 basis point of cost a leg,
  the recent years lose 1.7 a day.
- **Test 2 is mostly gold going up.** Over all years the night leg made +2.2
  a day before costs and the day leg +0.4. After 2 basis points a leg the
  pair loses 1.3 a day over the whole period. The recent years are above zero
  only while gold tripled, not clearly (t 0.5), and not at double cost.
- **Test 3 is a real lean that is smaller than its cost.** About +1.1 a day
  before costs in every period, against a cost of 1.5.

All three beat their luck runs before the bar on costs (ahead of 989, 969 and
992 of 1,000), so these were not random ideas. The same script finds test 1's
published effect in the years the papers covered, which is also a check on
the clock repair and on the code.

### What this means

1. The best-documented small effects we could find are gone, or are the
   market's own rise, or are smaller than what a small account pays to trade.
2. With the earlier studies, every idea tested in this lab has now failed
   after costs: chart methods, a bought robot, and published clock effects.
3. One idea from the search is still untested: slow trend following on daily
   prices across every market we can reach. The skeptic rated it weak, its
   record has been poor since 2009, and with about four independent markets
   its odds here are low.

### Deviations from the plan

- Amendment 1 (the clock repair), written before any return was computed.
- No other. Because nothing passed, the second implementation and the
  reviewers were not needed.
