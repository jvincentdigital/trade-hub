# Floors and ceilings: do price levels hold? Plan

Lab study, play money only. **Plan written 2026-11-18 before any result of
this study was computed and before any of its code existed.** Two reviewers
read a draft, one for anything two programmers could read differently or
that could see the future, one for ways the verdict could be fooled; their
findings are folded in. Results go at the bottom; the plan above them is not
edited (amendments are added below it and dated).

## Why

John asked (2026-11-17) to look on the bigger charts for the floor and the
ceiling, "an area ... every time it goes around this price, it turns back",
then to wait for a confirmation and either take a quick few pips or hold the
position for hours or days. He also asked to look at Fibonacci, at pairs that
move alike, and to find the pair where the idea works best.

The indicator research done the same day (`docs/indicator-research.md`) came
to one thing worth testing: levels. In 1996 to 1998 quotes, rates turned back
at levels that trading firms published 60.8% of the time, against 56.2% at
arbitrary levels, measured 15 minutes later (Osler 2000, New York Fed). Orders
do pile up at round numbers: take-profits at them, stop-losses just beyond
(Osler 2003), and price runs fast just past them for hours (Osler 2002). That
lean is small, old, and nobody tested whether it pays.

So the first question is not profit. It is: **does price turn at our levels
more often, and further, than at a nearby price that is no level at all?**
Only then: would the plain trade at the level have paid, on which pair?

Said in advance: this lab found a coin flip at Fibonacci levels, at the Owl's
grid steps and at the hours of the day. The likely answers here are "real but
too small to trade" or "not there". Osler found the yen strongest, so USD/JPY
round numbers are named now as the first place to look, whatever they show.

## Data and clocks

- The same seven 1-minute HistData files with the repaired clock as the
  harmonic study (their checksums go in the results): EUR/USD, GBP/USD,
  EUR/GBP, EUR/JPY, USD/JPY and GBP/JPY 2005 to 2025, gold 2009 to 2025.
  Prices are the Bid. A file that fails the clock check is left out and named.
- **Choosing years: 2005-01-01 to 2018-12-31** (gold from 2009), in two
  halves: 2005 to 2011 and 2012 to 2018 (gold: 2009 to 2013 and 2014 to
  2018). **Checking years: 2019-01-01 to 2025-12-31.** A visit belongs to the
  period and the year of its touch minute, a trade to those of its fill
  minute (UTC).
- New York time is the zone `America/New_York`, with the daylight-saving
  rules of each year. On the night when 01:00 to 01:59 happens twice, both
  hours belong to the 01 candle.
- **A day** runs from 17:00 New York time to the next 17:00 and is named by
  the date it ends on. A candle stamped from Friday 17:00 to Sunday 17:00
  belongs to Monday's day, so days are named Monday to Friday. **A week** is
  the days named Monday to Friday of one calendar week.
- **4-hour candles** start at 17, 21, 01, 05, 09 and 13 New York time.
  **15-minute candles** sit on UTC clock boundaries. A candle's time is its
  clock boundary, not the stamp of its first minute.
- A candle or a day exists if it holds at least one 1-minute candle. Every
  count of candles or days counts existing ones, and "previous" means the
  previous existing one. A chart candle closes at its clock end, which a
  program learns when it reads a minute stamped at or after that end, and is
  used only once closed; a candle with no such minute in its file never
  closes.
- Swings, ATRs, zones and everything remembered run over each whole file from
  its first candle, with no reset at weekends, gaps or year ends.
- **True range** of a candle = max(high, previous close) - min(low, previous
  close); the first candle of a file uses its high minus its low. **ATR at a
  candle** = its true range and the 13 before it, added in time order, then
  divided by 14 (worked out afresh each time, never updated from the last).
- **"ATR" with no other word means the daily ATR in force**: in any minute,
  the ATR at the last existing day before that minute's own day (on a Monday,
  Friday's; after a holiday with few candles, that holiday's, counted like
  any other day). The zones' bands use the 4-hour or daily chart's own ATR at
  a candle; twins, visits, races and trades use the ATR in force. These two
  are not the same thing and are not to be made the same.
- Nothing is watched before the 15th existing day of a file.
- A pip is 0.0001, 0.01 for the yen pairs and $0.10 for gold.
- Every test of a price against a level, an edge or a distance is inclusive
  ("at or beyond"), with a tolerance of 1e-9: a price within 1e-9 of a line is
  at the line. The swing finder's "strictly higher" and "strictly lower"
  compare candle prices as read from the file.
- **A window of N hours after minute `t`** holds the minutes stamped after
  `t` and earlier than `t` + N x 3600 seconds.

## Order of work (so the checking years cannot leak into the code)

1. Unit tests, the second level finder and any fix use the choosing years
   only. The programmers work on copies of the files that end at 2018-12-31,
   and the full files are made unreadable until the check.
2. The code is committed and pushed; the commit is named in the results.
3. The choosing run reads no price after 2018-12-31. A race still open at the
   last minute counts as neither. A trade still open closes at the Bid close
   (a buy) or the Bid close plus the spread (a sell) of the last minute,
   after that minute's stop and target tests, as one market fill.
4. Only then is anything from 2019 on computed, once. The checking run writes
   a marker before it reads the first price of 2019 and refuses to repeat.
   The levels are built over each whole file, and the last minute of a file
   closes races and trades the way the last minute of 2018 does above.
5. Before the checking run prints or saves anything of 2019 on, it compares
   its visits and trades whose every outcome was settled by a minute of 2018,
   not by the end of the data, with the same ones in the choosing run. If
   they differ it stops and says so. Nothing of 2019 has then been seen, and
   the marker may be removed once, with the reason written in the results.

## Swings (used for zones and for Fibonacci)

The harmonic study's swing finder, with size 2, on the 4-hour chart and on
the daily chart, each with its own ATR at the candle:

- Start with a high forming, the first candle's high as the candidate.
- While a high is forming: a candle whose high is strictly higher than the
  candidate becomes the candidate and does nothing else (on a tie the earlier
  candle stays). Otherwise, if the candle's low is at or below the candidate
  minus 2 times the ATR at that candle, the high is **confirmed at that
  candle's close**. The candidate low is then the lowest low of the candles
  after the high's candle through the confirming candle (the earliest on a
  tie), and the search for the low's confirmation starts at the next candle.
- Lows mirror this. A candle confirms at most one swing. No swing is
  confirmed before the 14th candle.
- Everything a candle's close decides (a swing, and what the swing does to
  zones and Fibonacci levels below) takes effect from the first 1-minute
  candle stamped at or after that close, never earlier.

## The levels

A level is a band of price with a low edge and a high edge (a line when they
are equal), a life, and the sides it may be visited from. Its **first watched
minute** is the first minute of its life on or after the 15th day. Its year,
for counting levels, is the UTC year of that minute. Ten kinds:

**Round numbers** (lines, always live, visited from either side), built as
whole numbers of pips.

|                           | R00, the big figures | R50, the half figures      |
| ------------------------- | -------------------- | -------------------------- |
| EUR/USD, GBP/USD, EUR/GBP | multiples of 0.0100  | the prices halfway between |
| The yen pairs             | multiples of 1.00    | the prices halfway between |
| Gold                      | multiples of $50     | other multiples of $10     |

**PD, yesterday's high and low.** On each day, two lines: the high and the
low of the previous day. Live for that day. Visited from either side.

**PW, last week's high and low.** The same for weeks: the high and the low of
the previous week, live for the whole of the current week.

**Z4 and ZD, zones price has turned back from three times** (John's idea),
on the 4-hour chart and on the daily chart. Ceilings are built from confirmed
swing highs; floors from swing lows, mirrored. Each time a swing high is
confirmed, at candle `j`, with price `h` and `a` = the chart's ATR at `j`:

1. It joins a ceiling that has not died and whose band, widened to hold `h`,
   would be no wider than 0.5 x `a`. If several could take it, the one whose
   middle is nearest to `h` takes it (the older on a tie). That band is
   widened to hold `h`, and the ceiling has one more turn.
2. Otherwise it starts a new ceiling: the band is the line at `h`, one turn.

A ceiling dies at the close of a chart candle that closes at or above its
high edge plus 0.25 x that candle's ATR, and at the close of the 540th chart
candle (daily chart: the 250th) after the candle that confirmed its latest
turn. At a candle's close the deaths come first, then the swing that candle
confirmed joins or starts. A dead ceiling never returns.

A ceiling is **armed** when its third turn is confirmed. From that close
until its death it is a level, visited from below only (a floor: from above
only). A ceiling with exactly two turns is watched too, as a **two-turn
zone**, from its second turn's close until its third turn or its death: it is
not one of the ten kinds, has its own twins by the same rules, and is counted
against them beside its kind, never inside the kind's lift. When a two-turn
zone is armed, the two-turn watch ends at that close (a visit already open
runs on and stays a two-turn visit), and the armed zone starts as a new
level: nothing remembered, its twins placed afresh.

**Fibonacci levels**, on the 4-hour chart (F4) and the daily chart (FD). When
a swing high `H` is confirmed, with `L` the confirmed swing low before it,
the leg from `L` to `H` is complete and its pullback levels are floors at
`H - r x (H - L)`:

- **FC, the classic three** (F4C, FDC): three lines, at `r` = 0.382, 0.5 and
  0.618.
- **FJ, John's area** (F4J, FDJ): one band from `r` = 0.786 (its high edge,
  met first) to `r` = 0.886.

A level is not used if the candidate low at `H`'s confirmation is at or below
its high edge. The first swing high of a file, with no confirmed low before
it, gives no levels. A level's life runs from the confirming candle's close
until the first of: the end of its own first visit; the close of the candle
that confirms the next swing on that chart; a minute whose Bid high is at or
above `H` (the life ends after that minute's tests). Floors are visited from
above only, under the same away rule as every other level. A completed
down-leg gives ceilings the same way, mirrored.

**Levels that sit on a round number.** A level of the eight kinds that are
not round numbers is left out of its kind, and reported apart, when in its
first watched minute its nearest edge lies within 0.05 x ATR of a round
number of that market. Twins have the same rule, so neither side borrows the
round number's effect. A level left out this way keeps its twins in its
kind's pool, and still counts as a level being watched when other twins are
tested against it.

## Twins: the nearby prices that are no level

Every level has twins, measured with exactly the same rules. A twin is the
bar to beat.

- **Round numbers.** A twin grid is the market's half-figure spacing (50
  pips; gold $10) moved up by `u`, for `u` = 15.0, 15.5 ... 35.0 pips (gold:
  $3.00, $3.10 ... $7.00): 41 twin grids, every line of them at least 15
  pips ($3) from a round number. Twin lines are visited from either side.
  R00 and R50 are both measured against all 41 grids.
- **Every other kind.** 46 twin sets, numbered by `m` = 0.40, 0.41 ... 0.85.
  In set `m` each level has a **lower twin**, the level moved down by `m` x
  ATR, visited from below only, and an **upper twin**, moved up the same,
  visited from above only. The ATR is the one in force in the level's first
  watched minute, and the offset stays fixed. A level visited from one side
  only has only the twin on that side. So a twin is always met first, on the
  same approach, before price gets to the level.
- A twin has its level's life and moves with its level's band, except that a
  Fibonacci twin's life ends at the end of its own first visit (or with the
  other two endings of its level's life).
- A twin is left out, for that level, when in its first watched minute its
  nearest edge lies within 0.05 x ATR of a round number of that market, or
  inside or within 0.05 x ATR of another level of the same kind that is being
  watched in that minute (all Fibonacci levels of one chart count as one kind
  here; armed zones are tested against armed zones, two-turn zones against
  two-turn zones). This rule is not used for the round-number grids.

## A visit, and what happens after it

Each level and each twin is watched minute by minute, from its first watched
minute, on Bid candles. With `g` = 0.25 x the ATR in force in that minute:

- Price is **away below** in a minute whose Bid low is at or below the low
  edge minus `g`, and **away above** in a minute whose Bid high is at or
  above the high edge plus `g`. The latest of the two is remembered (a minute
  that does both clears it). In the first watched minute nothing is
  remembered, so no visit can start in it.
- **A visit from below** starts, at a level that may be visited from below,
  in the first minute, while the level is live and price was last away below,
  whose Bid high is at or above the low edge. That minute is the **touch
  minute**; the low edge is the **near edge** and the high edge the **far
  edge**. A visit from above mirrors this.
- **The edges, the ATR and `g` of a visit are fixed at its touch minute** and
  do not change while the visit, its races or its trades run. A band that
  widens applies to the away tests and to later visits, from the first minute
  at or after the close that widened it.
- The visit **ends** in the first later minute whose Bid low is at or below
  the near edge minus `g` (price turned; away below is then remembered) or
  whose Bid high is at or above the far edge plus `g` (price broke through;
  away above is remembered; a minute that does both is a break).
- In each minute, for each level: if a visit is open, its end test; else the
  touch test with what was remembered before. The away update runs only in a
  minute that neither started nor ended a visit and had no visit open; in an
  end minute the memory is the one the end sets. A new visit can start no
  earlier than the minute after the end minute.
- A level's life only decides when a visit may start. The visit, its races
  and its trades run on after the life ends.

For each visit, with `t` the touch minute:

- **The race**, at four distances `d` = 0.10, 0.25, 0.50 and 1.00 x ATR. In
  the minutes after `t`, a **turn** is a minute whose Bid low is at or below
  the near edge minus `d`; a **break** is a minute whose Bid high is at or
  above the far edge plus `d`. Whichever comes first counts; a minute that
  does both is a break. The race stays open for a window of 24 hours after
  `t` for 0.10 and 0.25, and 120 hours for 0.50 and 1.00; after that it is
  "neither". **Turn rate** = turns / (turns + breaks).
- **Fifteen minutes later** (the measure of the 2000 study), and 60 minutes
  later: the Bid close of the last candle stamped earlier than `t` plus that
  many minutes. Below the near edge is "back", above the far edge is
  "through", anything else (and a close within 1e-9 of an edge) is "at the
  level".
- **How far.** The near edge minus the lowest Bid low (not below zero) over
  the minutes after `t` and before the minute of a break at 0.25 x ATR,
  inside the 24-hour window; in pips and in ATR.
- **After a break.** With `P` = the far edge plus 0.10 x ATR: the first
  minute, from `t` through the visit's end minute and earlier than 24 hours
  after `t`, whose Bid high is at or above `P` is the **break minute**. In
  the minutes after it, at `d` = 0.10, 0.25, 0.50 and 1.00 x ATR: a **run**
  is a Bid high at or above `P + d`, a **fail** a Bid low at or below
  `P - d`; the first counts, both in one minute is a fail, and the windows
  are the same, counted from the break minute. **Run rate** = runs / (runs +
  fails).

All of this is written for a visit from below. A visit from above mirrors it.

## Three plain trades, with no confirmation beyond the level itself

Costs are the harmonic study's. Ask = Bid + spread; spreads EUR/USD 0.8 pip,
GBP/USD 1.0, EUR/GBP 1.0, USD/JPY 0.9, EUR/JPY 1.3, GBP/JPY 2.0. Gold's spread
is $0.28 x `X` / $1,800, where `X` is the order's price (T0, B0) or the Bid
open of the entry minute (T1), fixed for the whole trade; gold also pays
$0.07 an ounce, once a trade, as a cost outside the prices. Buys enter at the
Ask and close at the Bid, sells the other way. Each market fill (a market
entry, a stop order's entry, a stop-loss, a time exit, the end of the data)
lowers the result by 0.2 pip; that 0.2 pip is a cost, not part of a price. R
is the distance from the entry price to the stop. A trade is skipped when R
is under 5 times its round-trip cost (its spread, plus $0.07 for gold). All
distances use the ATR in force at the visit's touch minute. Described for a
visit from below, where the level is a ceiling:

- **T0, an order at the level.** A sell order at the near edge, working in
  the touch minute and every later minute up to and including the visit's end
  minute. It fills, at the near edge and never better, in the first of those
  minutes whose Bid high is at or above the near edge plus 0.5 pip (gold
  $0.05). A buy order at a floor fills in the first minute whose Bid low plus
  the spread is at or below the near edge minus 0.5 pip. Stop: the far edge
  plus 0.25 x ATR.
- **T1, after price closes back out** (the one plain confirmation). The
  trigger is the first 15-minute candle, among the eight that start with the
  one holding the touch minute, that closes at or below the near edge minus
  0.05 x ATR. There is no trade if, in a minute from the touch minute through
  the last minute of the trigger candle, the Bid high reached the far edge
  plus 0.25 x ATR. Entry: at market at the open of the first minute stamped
  at or after the trigger candle's close; skipped if that open is at or below
  the near edge minus 0.25 x ATR. Stop: 0.10 x ATR above the higher of the
  far edge and the highest Bid high from the touch minute through the last
  minute of the trigger candle.
- **B0, with the break.** A buy stop order at `P` = the far edge plus 0.10 x
  ATR, working in the touch minute and every later minute up to and including
  the visit's end minute, and earlier than 24 hours after the touch minute.
  It fills in the first of those minutes whose Bid high plus the spread is at
  or above `P`, at `P`, or at that minute's opening Ask if that is higher.
  Stop: 0.25 x ATR below the entry price.

Each trade is tested with two exits: **quick**, a target 0.25 x ATR from the
entry price and a time exit 24 hours after the fill minute; and **hold**, a
target 1.00 x ATR from the entry price and a time exit 120 hours after the
fill minute. The stop is the same for both.

Fills, on 1-minute candles: a sell's stop is hit when the Bid high plus the
spread is at or above it, its target when the Bid low plus the spread is at
or below it; a buy's stop when the Bid low is at or below it, its target when
the Bid high is at or above it. A stop fills at its level, or at the minute's
open when the open is already beyond it; a target fills at its level. In the
fill minute only the stop is tested. From the next minute on, a stop and a
target inside one minute count as the stop. A time exit closes at the open of
the first minute stamped at or after its time, before any other test in that
minute. Trades stay open over the weekend. One trade of each kind per visit;
trades may overlap. Twins trade the same way at their own prices.

## Counting

- For each visit of a level that ended its race in a turn or a break, `z` =
  (1 for a turn, 0 for a break) minus the turn rate, at that distance, of the
  visits to that kind's twins (all twin sets together) in the same market,
  the same UTC year and from the same side. **A market's lift** is its
  average `z`, in points out of 100. **The lift of a kind of level** is the
  plain average of its markets' lifts, so no one market decides it. Runs
  after a break are counted the same way against the twins' run rate.
- **The t of a lift** is the lift divided by its standard error. The standard
  error is the standard deviation of the lift over 2,000 draws (seeds 1 to
  2,000 of one fixed generator, named in the results). A **counting week** runs
  from Saturday 00:00 UTC to the next; it is not the Monday-to-Friday week of
  PW. A draw takes the counting weeks that hold a visit of the kind or of its
  twins (by touch minute, all markets together; for one market alone, that
  market's), sorted by start time, and draws as many of them as there are, by
  index, with replacement. It carries all the visits of the drawn weeks,
  levels and twins alike, and works out the twins' rates and the lift again.
  A visit with no twin rate to be measured against in a draw is left out of
  that draw, and so is a market with no level visit. The standard deviation
  uses n - 1.
- A trade's result is in R, after costs. Before costs adds back the round-trip
  cost and the 0.2 pips; double cost takes each away once more. Nothing is
  simulated again for either. **A trade's weekly t**: the sums of results per
  counting week (by fill minute, all markets together, weeks with no trade
  left out), their mean divided by their standard error (standard deviation
  with n - 1, over the square root of the number of weeks).
- **A trade's gap to its twins**: for each trade at a level, its result minus
  the average result of the same trade at that kind's twins in the same
  market, UTC year and side ("the same trade" is the same kind of trade and
  the same exit; a trade with no twin trade there is left out). The gap is
  the average of these over all the trades together, not market by market.
  Its t comes from 2,000 draws of the counting weeks that hold such a trade,
  at the level or its twins, by fill minute, with the twins' averages worked
  out again in each draw.
- "Above zero", for a half, a year or a market, means its lift (or its sum of
  results) is above zero; one with no visit (no trade) is not above zero.

## What is reported, in this order

**The summary comes first**, on one screen. One line per kind: out of 100
visits, how many turned at the level and how many at the nearby prices (at
0.25 x ATR); the median pips a turn went; T0 and T1 quick in pips a trade
before costs, then after; the reading of each of its rules that was chosen
(or "not seen at N points or more"). Then one line for each of John's
questions: the floors and ceilings of the bigger charts (Z4 and ZD, with two,
three and four or more turns side by side); what waiting for the close back
out adds (T1 beside T0); quick against hold; Fibonacci (the four Fibonacci
kinds); the best pair (the pair candidate, or "none").

1. **Part 1, how often.** Per kind, market and year: levels, visits, and how
   many visits ended in a turn, a break or neither.
2. **Part 2, do the levels hold?** Choosing years. Per kind, per market and
   for all markets: visits; the turn rate beside the twins' at each distance,
   with that distance's average size in pips, and "neither" beside them;
   "back" after 15 and 60 minutes beside the twins'; how far price went back
   (median and mean); the run rate after a break beside the twins'. A kind's
   rates are the plain averages of its markets' rates, and the twins' rate
   shown is the average of the rates the level's visits were measured
   against, per market first and then the plain average of the markets, so
   the two always differ by the lift. In the result files the
   same split by side, by first and later visits, by New York clock (17:00 to
   02:59, 03:00 to 07:59, 08:00 to 11:59, 12:00 to 16:59), by number of turns
   for zones (two, three, four or more, counted at the touch minute), by
   Fibonacci ratio, for levels that sit on a round number, and for each twin
   set.
3. **Part 3, the plain trades.** Choosing years. Per kind and market, for T0,
   T1 and B0, quick and hold: trades, how often the target came first beside
   the rate needed to break even, average result before costs in pips and in
   R, then after costs, the weekly t, the gap to the twins, and how many twin
   sets it is ahead of. For T0 also the share of visits whose order filled,
   for levels beside twins.
4. **Part 4, choosing and the single check** (below).
5. **Part 5, pairs that move alike.** The correlation of daily changes (close
   to close of days with the same name, in percent, days missing in either
   market left out) between each two markets, and of 4-hour changes, for 2005
   to 2011 and 2012 to 2018 (2019 to 2025 after the check). Pairs above 0.7
   are named as close to one bet.

Every table leads with how often price turned and how far it went, before
costs; the after-cost figure sits beside it.

## Part 4: choosing on the old years, one check on the new ones

**Forty rules**: ten kinds of level x four readings.

| Reading    | The level measure                 | Its trades         |
| ---------- | --------------------------------- | ------------------ |
| Turn quick | turn rate at 0.25 x ATR, 24 hours | T0 quick, T1 quick |
| Turn hold  | turn rate at 1.00 x ATR, 120 h    | T0 hold, T1 hold   |
| Run quick  | run rate at 0.25 x ATR, 24 hours  | B0 quick           |
| Run hold   | run rate at 1.00 x ATR, 120 hours | B0 hold            |

**A rule is chosen** when, on 2005 to 2018, all hold:

1. its lift is 2 points or more;
2. the lift is above zero in at least 5 of the 7 markets (with fewer markets:
   in more than two thirds of those used);
3. the lift is above zero in each half;
4. its t is 3.0 or more.

**The pair candidate.** The forty rules are also read on each market alone. A
rule on one market qualifies with at least 150 visits that ended in a turn or
a break (a run or a fail), a lift of 4 points or more, a lift above zero in
each half, and a t of 3.5 or more. The one with the highest t is the pair
candidate; a tie goes to the first in the order of the kinds as listed above,
then the readings as listed, then the markets as listed under "Data".

For every rule the report prints the smallest lift this test could have
seen: the larger of the bar (2 points) and 3.0 times the rule's standard
error. A rule that is not chosen is written as "not seen at N points or
more", with that number.

If no rule is chosen and there is no pair candidate, the study ends there:
**"price did not turn or run at these levels more than at nearby prices,
even in the years used for choosing"**. The checking years stay closed.

**The check, once, on 2019 to 2025,** for every chosen rule and for the pair
candidate. The number of rules, and of rule and trade pairs, taken to the
check is printed with the verdict.

The level lines (L):

- L1: a lift of 1.5 points or more;
- L2: a t of 2.0 or more;
- L3: the lift above zero in more than half of the markets used (not for the
  pair candidate).

The trade lines (P), for each of the rule's trades, after costs:

- P1: at least 200 trades (the pair candidate: 100);
- P2: a weekly t of 2.5 or more (3.0 when more than ten rule and trade pairs
  go to the check);
- P3: at least 5 of the 7 years above zero;
- P4: a gap to its twins above zero, with a t of 2.0 or more;
- P5: an average result above zero at double cost;
- P6: more than half of the markets used above zero (not for the pair
  candidate).

**Readings, fixed now and tried in this order:**

- **"Worth a play account"**: the level lines hold and one of the rule's
  trades passes every trade line. Before John is told so, a second
  implementation of that trade and two reviewers must fail to break it.
- **"Positive, not proven"**: the level lines hold and no trade passes, but
  one trade's average result after costs is above zero on 2019 to 2025 with a
  weekly t of 1.5 or more, and its gap to its twins has a t of 1.5 or more.
  In those words it may be offered to John for a play-money account as the
  next test, never as a proven rule.
- **"Real but too small to trade"**: the level lines hold and no trade earns
  either reading above.
- **"Not there"**: the level lines do not hold. If one of its trades passes
  every trade line all the same, that is printed beside it.

A Run rule for a kind whose Turn reading at the same distance also has a lift
of 2 points or more is read as "price moves at this level", not as "breaks
run": a level that turns price also holds back its twins' runs.

Also reported, to show whether choosing carried information: the lifts of all
forty rules on 2019 to 2025 as description (no trade results for rules that
were not chosen), how many are above zero there, and the rank correlation
(Spearman) of the forty lifts between the two periods. Nothing from the
checking run is used to choose.

## How the numbers are checked

- Unit tests on hand-made candles, with answers worked out by hand: each
  kind of level; a zone is armed at its third confirmed turn and never
  before; the away rule, the touch and the order inside a minute; the race
  and its windows; a twin sits exactly where the rule puts it; every fill
  rule for buys and for sells.
- **Known from.** Every level carries the time it became known (the close it
  came from). The program stops if a touch is earlier than that time, or if a
  level was built from a candle that closed after it.
- **The cut test.** For 40 minutes picked by a seeded generator over the
  choosing years and the markets (10 of them in the first hour of a day, 10
  the first minute after a 4-hour close, one in the last two hours of 2018),
  the file is cut to the minutes stamped at or before it and everything is
  run again. The levels with their bands, each twin's price, the ATR in
  force, what each level and twin remembers, every open visit, and every
  visit, race and trade already decided must equal the run on the whole file.
  "Already decided" means settled by a minute at or before the cut, not by
  the end of the data.
- **Placebo 1, a twin as the level.** On the choosing years twin set 0.60
  (round numbers: the grid at 25.0 pips, $5.00) is treated as the level and
  measured against the sets at least 0.10 away from it (round numbers: the
  grids at least 5 pips, $1, away), by market, UTC year and side as always.
  Its lift at 0.25 x ATR must be inside plus or minus 1.5 points or 2.5
  standard errors, whichever is wider.
- **Placebo 2, shuffled days.** Each market's days are put in a random order,
  each day changing places only with days of the same name in the same block
  of years (the two halves of the choosing years and, in the checking run
  only, 2019 to 2025), by a Fisher-Yates shuffle from one named generator with
  seed 1. A day keeps its own 1-minute candles. In time order, every price of
  a moved day is multiplied by the close of the day now before it over the
  close of the day that was really before it; the first day of a file keeps
  its prices. Each minute keeps its New York clock time, counted from its
  day's 17:00 start. A minute whose new stamp falls outside its new day, or on
  a stamp already taken, is dropped. All ten kinds, their twins, visits and
  races are then built on this series exactly as on the real one. No price can
  remember an earlier day here, so a lift on it comes from where a level sits,
  not from what happened there. Each kind's lift on it is reported beside the
  real one, for the turn rate at 0.10, 0.25 and 1.00 x ATR and the run rate at
  0.25 and 1.00 x ATR, and should lie within 2.5 standard errors of zero.
  Levels made and met inside one day (some of F4 and Z4) keep their real past
  in the shuffle, so for those kinds the test is a cautious one, and that is
  said where it applies.
- If Placebo 1 falls outside, the cause is found and written down before any
  real result is read.
- **If a rule's Placebo 2 lift lies outside 2.5 standard errors of zero on the
  choosing years, the rule is read on the rest**: its lift minus its Placebo
  2 lift, worked out the same way for each market and each half, with a
  standard error that is the square root of the sum of the two squared
  standard errors. The choosing bar and the level lines L1 to L3 are then
  applied to the rest, on the choosing years and again on 2019 to 2025, where
  Placebo 2 is run once inside the single check. The tables show both parts,
  and the cause is looked for and written down before any real result is
  read.
- A second person writes the level builder and the visit finder alone from
  this page, in another language. The two lists of levels and of visits (every
  twin set, touch minutes, race outcomes, the 15 and 60 minute answers, how
  far, and what happened after a break) must match on EUR/USD for 2005 and
  2012, USD/JPY for 2012 and gold for 2013, for all ten kinds: prices to
  1e-9, times and outcomes exactly.

## Limits, said in advance

- Forty rules on seven markets is a lot of trying. Requiring most markets and
  both halves, and one check on years the choice never saw, is the answer to
  that. The pair candidate is the best of 280 tries; its bar is higher for
  that reason and it is still the easiest thing here to be fooled by.
- 2019 to 2025 are not blind to the lab: other rules were tested there.
- These are quotes of one free feed, Bid only. Quotes bounce more than
  trades, so a turn rate above 50 means nothing by itself. Only the gap to
  the twins counts, and a plain trade must still pay on its own.
- A twin is not a perfect stand-in. At yesterday's high price is making a new
  high; at its twin it is not. So a lift says "this is a better place to
  fade than a nearby price met on the same approach", whatever the reason.
  The shuffled days say how much of it needs no memory at all.
- The shuffled days cannot show an effect that needs several days in a row
  (ranges that stay large for days, the shape of a week), and their ATR fits
  each day less well than the real one does. A Placebo 2 lift that comes only
  from days whose range is more than 1.5 x the ATR in force is named so in
  the results.
- At the hold distance a twin's race reaches across the real level, and at
  the quick distance a round-number twin's race reaches the round numbers
  beside it. If levels turn price, this makes a Turn lift look smaller and a
  Run lift look bigger; if they do not, it changes nothing. The 0.10 distance
  and the 15-minute measure are the clean ones for round numbers.
- The daily kinds (ZD, FD, PW) have few visits. They can only show a large
  lift; a small one is "not seen", not "not there".
- An order at a level needs price to go 0.5 pip through it. If price turns
  exactly at a round number, T0 misses the best turns at levels more often
  than at twins. The fill rates are printed for that reason.
- A trade that fills in the touch minute, or at a weekend gap, has its stop
  tested in that same minute against the whole minute. That is the harsh
  reading, and twins get it too.
- The seven markets are about four separate bets. Counting by whole weeks
  keeps touches that happen together from being counted as independent.
- Gold's $10 figures sit very close together once gold's daily range grows;
  in the recent years its $50 figures are the ones to read.
- In 2005 to 2007 some files hold fewer 1-minute candles a day (EUR/GBP the
  fewest, counted from the time stamps alone). Levels and twins see the same
  candles.
- Assumed typical spreads; no overnight financing is counted on trades held
  for days.
- Play money only. No broker is connected. This is not financial advice.

## What comes after

Only for rules whose level lines hold: the confirmations, one at a time and
never stacked (John's candles, RSI, the bigger trend, a Fibonacci level on
top of a zone, a poke beyond the level that closes back inside, a sister pair
at a level at the same moment). That is a separate plan, written before its
code.

## Amendment 1: how the plan was read where it left a choice, what the placebos showed, and how every rule is read against prices with no memory (2026-11-18, written after the code was built and reviewed and before any real result table was read)

**What had been seen when this was written.** No lift, rate or trade result
of a real level. The placebo tables of two practice runs on the development
copies; they hold no real result. And two status lines those practice runs
printed: the first said that one rule was chosen and that a pair candidate
exists; the second, after the review's fix to the shuffle (point 30), said
that no rule was chosen and that a pair candidate exists. Which rule and
which pair were not seen. The fix moved about ten days per market in the
shuffle and changed nothing else that a lift depends on, so the rule of the
first run was one of the five that were then "read on the rest" (R50 Turn
hold, PD Turn quick, PD Run quick, F4C Turn hold, F4C Run hold), and whether
it was chosen hung on the draw of one shuffle. That is one of the reasons for
the last part of this amendment. Its rules were fixed without knowing which
rule or pair they help or hurt.

The build met places where two careful readers could take the plan two ways.
Each was settled by the words closest to the plan, by people who had seen no
real result: the engine's author, the author of the second finder (who saw no
other code), a referee, and then the reviewers. They are listed here so the
results can be redone by anyone from this page. Where a point concerns levels
or visits, both programs use it, and their lists match on all 94 market-years
of the choosing period (the plan asks for four).

**Levels and twins**

1. **The tolerance.** The swing finder's "at or below the candidate minus 2
   times the ATR" and the zone's "no wider than 0.5 x `a`" use the 1e-9
   tolerance like every other inclusive test. Two zones whose middles are
   equally near to `h` within 1e-9 are a tie, and the older takes the swing.
   This decides one real case (EUR/USD, 2007-08-07).
2. **Sits on a round number.** The distance tested is the smaller of the two
   edges' distances to the nearest R00 or R50 line. A wide band with a round
   number strictly inside it and both edges further away is not left out.
3. **Two-turn zones** are never left out for sitting on a round number (the
   rule names the eight kinds). Their twins keep the twins' rule. So a
   two-turn zone's lift is not cleaned of round numbers on the level side.
4. **A twin that is left out** is not watched at all. It is in no list and no
   sum.
5. **"Another level of the same kind that is being watched in that minute"**
   is a level in its life in that minute, from its first watched minute
   through its last live minute. A Fibonacci level's life includes the end
   minute of its first visit. Levels left out for a round number count; the
   twin's own level does not.
6. **Round-number lines** are watched only inside the range of prices of the
   file. A line outside it can never be touched.
7. **A Fibonacci level** whose life ends before the 15th day is never
   watched. The minute at or above `H` that ends a life is searched from the
   confirming close on.

**Visits**

8. **The first watched minute.** No visit can start in it, but its own away
   test runs and is remembered from the next minute on.
9. **How far.** "The minute of a break at 0.25 x ATR" is the first minute
   inside the 24 hours whose Bid high is at or above the far edge plus 0.25 x
   ATR, whether or not a turn came first. With no minute before it, how far
   is 0.
10. **Fifteen and sixty minutes later**, when the file ends first: the close
    of the file's last candle.
11. **After a break**, a visit with no break minute is listed as "none".

**Trades**

12. **T1 at a floor.** The skip test compares the Bid open with the near edge
    plus 0.25 x ATR; the buy itself enters at the Ask.
13. **T1, R is a distance.** When the entry minute opens beyond the stop (a
    weekend gap), R is still the distance from the entry to the stop, and the
    trade is taken if R is at least 5 costs; it is then stopped at once, at
    that open. The first build skipped it. This adds 21 T1 trades at levels,
    to about 99,000, on the development copies.
14. **T0 and B0.** Whether R is under 5 times the cost is known before the
    order works, so the trade is skipped then. A skipped T0 counts as "not
    filled" in the share of visits whose order filled, for levels and twins
    alike.
15. **A twin's trade** is counted in the year and the counting week of its
    fill minute, like a level's.

**Counting, choosing and the report**

16. **The order of the kinds** (the forty rules, the pair candidate's tie) is
    the order in which "The levels" names them: R00, R50, PD, PW, Z4, ZD,
    F4C, FDC, F4J, FDJ. The markets are in the order of "Data": EUR/USD,
    GBP/USD, EUR/GBP, EUR/JPY, USD/JPY, GBP/JPY, gold.
17. **The 2,000 draws** take every counting week that holds a visit of the
    kind or of its twins, also a week whose visits all ended "neither".
18. **The pair candidate's 150 visits** are that market's visits of the kind
    that ended in a turn or a break (a run or a fail).
19. **Trade lines.** P3: a year with no trade is not above zero. P4: the gap
    is above zero and its t is 2.0 or more.
20. **Part 1** counts a visit as a turn, a break or neither by its race at
    0.25 x ATR.
21. **The summary.** "How many turned" is the turn rate at 0.25 x ATR (turns
    out of turns and breaks). "The median pips a turn went" is the median of how far, over the
    visits whose race at 0.25 x ATR was a turn, all markets together.
22. **Rows for all markets** in the trade tables pool all trades, as the gap
    and the weekly t are defined; pips of different markets are added as they
    are.
23. **The twins' rate shown** beside "back" after 15 and 60 minutes,
    "neither", the run rate and the T0 fill share is built like the one
    beside the turn rate: the average of the twin rates (same market, UTC
    year and side) that the level's visits are measured against.
24. **The rate needed to break even** is the `p` for which `p` x W + (1 -
    `p`) x L = 0, with W the average result after costs of the trades whose
    target came first and L that of the others.
25. **"Ahead of N twin sets."** The level's average result after costs
    against each twin set's (each grid's) average over the same markets and
    years, not matched by year and side.

**The one check**

26. **The same files.** Before the marker is written the check asks for the
    same set of markets as the choosing run. After it, and before anything of
    2019 on is saved, a fingerprint of all candles stamped before 2019 must
    equal the choosing run's.
27. **Order of work, point 5.** Compared: every visit to a level or a round
    number with its trades, settled by a minute of 2018 (every field to 1e-9,
    except a level's serial number and the range of the touch day), and the
    twins' weekly sums for counting weeks that ended at least seven days
    before 2019, except three counts that wait for a visit's end (T0 fills,
    ended in a turn, ended in a break). The twins' sums by set are not
    compared. For the twins this is a sound stand-in for the plan's "visits
    and trades", not the comparison record by record.

**The plan's own checks**

28. **The cut test.** No file holds a minute in the last two clock hours of
    2018 (the files end at 17:00 New York time), so that one minute is drawn
    from the two hours before each market's last minute of 2018. "The first
    hour of a day" is 17:00 to 17:59 New York time. A round-number line
    beyond a cut file's range of prices is excused when it has no open visit.
    The cut test sees a look-ahead only when its reach crosses one of the 40
    cut minutes; for the away rule the guard is a unit test that compares the
    watch with a literal minute-by-minute copy.
29. **Known from.** Every level carries the close of the latest candle its
    prices were read from (PD: the previous day; PW: the last day of the
    previous week; a zone: the candle that confirmed each turn, band by band;
    a Fibonacci level: the later of its two swings' confirming candles). The
    program stops if that close is later than the time the level is known
    from, or later than the first minute its band is used. The first build
    compared two numbers taken from the same candle, which could never stop
    it.
30. **Placebo 2.** Days change places with days of the same weekday. A day
    belongs to a block by the date it is named by; gold uses its own halves.
    The first day of a file stays where it is. Only a moved day is rescaled,
    as the plan says; a day left in its own place keeps its real prices, also
    after a moved day (the first build rescaled every day after the first).
    A minute keeps its New York wall-clock time on its new date. One generator
    (mulberry32) per market, seeded with the seed number, so markets with the
    same calendar get the same order of days and go on moving together; the
    groups are shuffled block by block, then Monday to Friday.
31. **Wide days.** A day is wide when its range is more than 1.5 x the ATR in
    force at the touch. A Placebo 2 lift is said to come only from wide days
    when it is outside on all days and no longer outside without them. A
    day's range holds the minutes after the touch, so this split is partly
    made by the outcome itself: on walks with no memory it alone gives the
    calm days a positive and the wide days a negative Turn lift. The line is
    printed where the plan asks for it and does not by itself name a cause.
32. **Placebo 1** is also worked out for the two-turn zones.
33. **Order of the report.** The summary comes first, as the plan says, and
    the placebo section right after it. The lead reads the placebo section
    first.

**The review**

Two reviewers read the code against this page, an auditor re-worked trades
from the raw minutes with a program of its own, and a fourth person looked
for the causes of the placebo readings below. None of them read a real result
table. No look-ahead and no error in a trade, a cost or a count was found.
Found and fixed before any run that counts: the "known from" guard that could
never stop the program (point 29); T1's R (point 13); the rescaling of days
that had not moved (point 30); the order of the report (point 33); the two
list tools, which now refuse a file holding a bar of 2019 or later; and
twelve unit tests for rules that no test would have caught breaking (the
twins' left-out rule, a Fibonacci twin's single visit, T1's candle that never
closes, the buy side of T1, gold's costs, the time exits, Placebo 1's far
sets). The tests now number 129. The auditor's program re-worked 7,428 trade
rows and 668 visits with no trade from the raw 1-minute files, and the end,
status, fill, entry, stop and R of every one of the 165,644 visits: no
difference. A reviewer's own rebuild from this page agreed on 3,788
round-number visits with all their trades, and on the lifts, t's and gaps made
from them.

**What the placebos showed, and why**

The figures here are from the practice runs before the fix of point 30. The
run that counts prints its own; the causes were looked for on these.

Placebo 1 (a twin as the level; turn rate at 0.25 x ATR; lift, standard
error): R00 and R50 grids +0.24 (0.13); PD +0.35 (0.45); PW -0.57 (0.49); Z4
+1.49 (1.37); ZD +3.38 (2.47); F4C -0.23 (1.18); FDC +0.72 (1.77); F4J +1.65
(1.76); FDJ +2.94 (2.06): all inside. Two-turn zones: ZDx2 +0.88 (1.30),
inside; **Z4x2 +2.33 (0.74), limit 1.86: outside.**

The cause for Z4x2, as far as it was found. It is not an error: a second
program placed the twins and worked out the same +2.33, and none of 73,105
twin visits checked was misplaced. On 22 price series with no memory (below)
the same placebo gives +0.62 on average (spread 0.78, largest +2.19), so
about 0.6 of it comes from how two-turn zones and their twins are built. The
other 1.7 is a steady hump of 1 to 2 points in the twins' own turn rate at
sets 0.55 to 0.64, there in both halves, on both sides and in 10 of 14 years.
Looked at and ruled out: the swing's 2 x ATR distance, the neighbouring
swings, another watched level nearby, wide days, and visits that come in
clusters (drawing whole zones gives the same standard error as drawing
weeks). Whether it is chance (about 2.2 spreads out) or something in the
market at about 0.6 x ATR from a two-turn zone was not decided. The plan asks
for the cause to be found; it was found in part, and that is said again
beside every two-turn-zone result. For reading: the twin sets of two-turn
zones differ among themselves by up to about 2.5 points, so a two-turn-zone
Turn lift under about 2.3 points is no more than one twin set shows over the
others. Two-turn zones are not one of the ten kinds and nothing is chosen
from them.

Placebo 2 (shuffled days, seed 1) lay outside 2.5 standard errors of zero in
eight cells. Each was traced with ten shuffles (seeds 1 to 10) and with walks
that have no memory at all:

- **R50, turn rate at 1.00: -0.94 (0.27).** Chance of this one shuffle. The
  ten shuffles give +0.10 on average with a spread of 0.49; the walks give
  zero. The spread between shuffles is about twice the standard error from
  the 2,000 draws, so for round numbers at the hold distance that standard
  error is too small.
- **F4C, turn rate at 1.00: +3.83 (1.17), and run rate at 1.00: -4.08
  (1.36).** One chance event of this shuffle, read twice on the same visits.
  The ten shuffles give +0.62 and -0.91 with spreads of 1.26 and 1.61.
- **PD, turn rate at 0.10: -0.84, at 0.25: -1.09; run rate at 0.25: +1.18.**
  The shuffled series itself. All ten shuffles agree in sign (means -0.63,
  -0.49 and +0.64). On shuffled days the ATR in force comes from 14 unrelated
  days and fits the day badly, so twice as many visits fall on days wider
  than 1.5 x ATR (38% against 18% on the real series), and on those days
  price that reaches yesterday's high or low runs on more often than at the
  twin. Walks do not show it.
- **F4J, turn rate at 0.10: -3.14.** How the kind is built. An FJ band is a
  tenth of its leg wide. The twins that get visited come from wider bands,
  measured in ATR at the touch, than the levels that get visited (medians
  0.198 against 0.154 on walks), and at a fixed distance a wider band turns
  price more easily. It is there on every series with no memory (ten shuffles
  -3.65, walks -2.04) and goes away when band widths are matched.
- **ZDx2, run rate at 1.00: -7.83.** How the kind is built: series with no
  memory give the same (walks -6.43, ten shuffles -5.00).

**The wider finding.** On prices with no memory a lift is not zero for
several kinds. The plan's sentence "if they do not [turn price], it changes
nothing" does not hold for them. Mean lifts in points, over ten shuffles of
the real days and, in brackets, over six walks made from the real minutes
with each minute mirrored at random:

| Kind | Turn quick    | Turn hold      | Run quick     | Run hold       |
| ---- | ------------- | -------------- | ------------- | -------------- |
| R00  | -0.02 (-0.01) | -0.01 (+0.01)  | +0.04 (-0.31) | +0.02 (-0.01)  |
| R50  | +0.12 (-0.03) | +0.10 (+0.04)  | -0.09 (+0.06) | -0.10 (+0.05)  |
| PD   | -0.49 (+0.01) | -0.11 (+0.12)  | +0.64 (-0.04) | -0.01 (-0.26)  |
| PW   | +0.13 (-0.04) | +0.27 (+0.39)  | -0.13 (-0.04) | -0.56 (-0.44)  |
| Z4   | +1.91 (+2.12) | +2.34 (+3.68)  | -1.64 (-2.37) | -3.18 (-4.49)  |
| ZD   | +5.31 (+6.45) | +10.45 (+4.03) | -1.45 (-4.37) | -10.66 (-3.09) |
| F4C  | -0.03 (+0.65) | +0.62 (+0.35)  | +0.16 (+0.10) | -0.91 (-0.13)  |
| FDC  | +1.35 (+2.83) | +2.29 (+1.43)  | -1.18 (-2.13) | -2.32 (-1.23)  |
| F4J  | -2.81 (-1.27) | -0.92 (+0.04)  | +0.22 (-0.24) | -0.01 (-1.92)  |
| FDJ  | +0.69 (+1.88) | +0.57 (+1.05)  | -0.60 (-1.44) | -1.64 (-7.19)  |
| Z4x2 | +0.64 (+1.19) | +1.04 (+1.27)  | +0.02 (-1.53) | -1.12 (-1.80)  |
| ZDx2 | +3.60 (+5.65) | +4.11 (+6.03)  | -3.12 (-5.86) | -5.00 (-7.42)  |

Round numbers, yesterday's and last week's high and low, and the FC levels sit
near zero. The zones (John's floors and ceilings) do not: with every minute a
coin flip, a three-turn 4-hour zone still "turns price" about 2 to 4 points
more often than its twins and its breaks "run" about 2 to 4 points less
often, and the daily zones show more. Part of the cause was traced (for the
run rate, a zone is reached only after price has come through its own nearer
twins, whose runs then count against it; for FJ, the band widths) and part
was not. It does not have to be traced to be taken off: what prices with no
memory show cannot be the market remembering a level. These figures come from
the cause-finder's own programs; the runner now measures them itself, as set
out next, and its figures are the ones used.

**Every rule is read against prices with no memory**

The plan already takes a rule's Placebo 2 lift off its lift when Placebo 2 is
"outside" (the rule is "read on the rest"). The review showed two weak points
in doing that with one shuffle. One shuffle is a noisy measure: its draw alone
moved R50 Turn hold by 0.94 and the two F4C hold rules by about 4 points, and
in practice decided whether a rule was chosen. And for kinds with few visits
its standard error is too wide to flag an effect of several points that comes
from how the kind is built (Z4, ZD and FDC above), so such a rule would be
read plain and could be "chosen" on coin-flip prices. From here on:

A. **Two kinds of prices with no memory, ten series of each.**

- **Shuffled days**: the plan's Placebo 2, with seeds 1 to 10. Seed 1 is the
  plan's own and is still reported as the plan says.
- **Mirrored minutes**: the real 1-minute candles in their real order and at
  their real stamps, each minute either kept or turned upside down. In a
  turned minute every move is mirrored in ratio: the step from the close
  before to its open, the move from its open to its close, and its two wicks,
  which change places. With `o`, `h`, `l`, `c` the minute's real prices, `p`
  the real close before it and `P` the new close before it (for the first
  minute of the file, `p` and `P` are both its own open): a kept minute gets
  O = `P` x `o` / `p`, C = O x `c` / `o`, H = max(O, C) x `h` / max(`o`,
  `c`) and L = min(O, C) x `l` / min(`o`, `c`); a turned minute gets O = `P`
  x `p` / `o`, C = O x `o` / `c`, H = max(O, C) x min(`o`, `c`) / `l` and L =
  min(O, C) x max(`o`, `c`) / `h`. Whether a minute is turned is decided by its clock minute alone,
  the same in every market, so the markets go on moving together: one
  generator (mulberry32) per seed is drawn once for every clock minute from
  2000-01-01 00:00 UTC on, whether or not a market has a candle in it, and a
  minute whose draw is below 0.5 is turned. Seeds 1 to 10. Volatility keeps
  its real shape by hour, by day and by year; direction has no memory at all.

All kinds, their twins, visits and races are built on each of the twenty
series exactly as on the real one.

B. **A rule's baseline** against one of the two kinds is the mean of its ten
lifts there, each worked out like the lift itself, for all markets, for each
market and for each half; a series in which there is no lift to work out is
left out of that mean. **Its spread** is the standard deviation of those
lifts (n - 1). **The rest** is the lift minus the baseline, for all markets,
each market and each half.

C. **The standard error of a rest** is the square root of S x S + spread x
spread / n, where S is the larger of the lift's own standard error (the 2,000
draws) and the spread, and n is the number of series that had a lift. **Its
t** is the rest divided by that. A t needs at least two such series; without
them the line that asks for a t does not hold. A market or a half with no
series that had a lift has no rest and is not above zero.

D. **Every line the plan puts on a lift is put on the rest, against each of
the two baselines, and must hold against both.** That is: the four lines of
the choosing bar; the pair candidate's lines (its 150 visits are counted on
the real series; its baselines and spreads are its own market's); the level
lines L1 to L3 in the check; and the 2 points of the note on a Run rule. The
pair candidate is the qualifying rule whose smaller t of the two is the
highest, ties as the plan says. This holds for every rule, not only for the
ones Placebo 2 would have flagged. In the single check the twenty series are
built again on the whole files, and the baselines for the lines of the check
are worked out on 2019 to 2025 (the shuffle as the plan says, with 2019 to
2025 as its own block).

E. **"The smallest lift this test could have seen"** is the larger of 2
points and 3.0 times the larger of the rule's two standard errors of the
rest. The plain figure is printed beside it.

F. **The plan's own reading is still printed**, for every rule and for the
pair candidate: the lines on the plain lift, or on the rest against seed 1
alone where seed 1 lies outside 2.5 of its standard errors, as the plan words
it. Where the two readings differ, that is said. This amendment's reading
decides the words of the results. So that nothing the plan would have checked
stays unchecked, a rule or a pair candidate chosen under either reading is
taken to the single check, marked with the reading that chose it; the words
it is given there use the level lines on the rest, with the plain lines
printed beside them. The number of rule and trade pairs counted for line P2
is the number taken.

G. **The trade lines P1 to P6 and the trade conditions of the readings do not
change.** On prices with no memory no trade has an average result above zero
before costs, at a level or at a twin, so the trades need no baseline.

H. **Tables.** Parts 2 and 3 stay as the plan has them. The summary's line
for each kind adds the two baselines of the turn rate at 0.25 x ATR beside
the lift. The splits (by side, by clock, by number of turns, by ratio) have
no baseline of their own; they are read with the kind's baseline in mind, and
that is said above them. Beside each cell of Placebo 2's table (seed 1, with
the plan's "outside" mark) the mean and the spread of the ten shuffles and of
the ten mirrored series are printed. Anything in them that the causes written
above do not cover is looked into before the real tables are read.

**What this cannot do.** The two kinds of prices with no memory do not agree
everywhere (ZD Turn hold: +10.45 on shuffled days against +4.03 on mirrored
minutes; F4J Turn quick: -2.81 against -1.27). That is why a rule must pass
against both. A real market is neither of them. A rest says "more than both
kinds of prices with no memory give", and no more than that.

## Results

### How the run that counts was prepared (2026-11-18)

**The code for Amendment 1.** One programmer added points A to H to the
runner. A second read the change against this page, rebuilt the mirrored
minutes and every rest with programs of his own (the largest difference in a
mirrored price was 1 part in 10^14; all 2,880 baselines, spreads, rests,
standard errors and t's of a rehearsal agreed) and planted fourteen errors,
each of which a unit test caught. A third made three wording fixes. The unit
tests number 152. The code was committed and pushed (efb2339) before any real
table was read; the choosing run and the check both ran from that commit.

**Readings taken where Amendment 1 left a point open.** None was chosen by
looking at a result.

1. _Two pair candidates._ When the pair candidate on the rest and the one as
   written are different rules, both go to the check. It did not come up.
2. _The end of the study._ The study ends without a check only when nothing
   is chosen under either reading, as point F implies.
3. _The pair candidate as written._ The plan's sentence about reading a rule
   on the rest names the choosing bar and the lines L1 to L3. So the code
   puts the pair candidate's lines, as written, on the plain lift, also for a
   rule whose Placebo 2 lift is outside. This is the one reading that
   mattered: see Part 4.
4. _The note on a Run rule_ uses the smaller of the two Turn rests at the
   same distance.
5. _Point E with fewer than two series that had a lift:_ the smallest lift is
   written "not seen (no standard error)".
6. _The forty rules on 2019 to 2025_ are worked out without draws, as before,
   so their rests are printed without a standard error.
7. _The mirrored minutes_ are computed with each ratio taken first (O = P x
   (o / p)): the same algebra, and the high and the low keep their order
   exactly.

**A control run.** Before the run that counts, the same commit ran the whole
choosing step (2005 to 2018, ten series of each kind) on a made-up world: the
seven development files with every minute kept or turned by seed 99, that is,
prices with their real swings in size and no memory of direction. Nothing was
chosen there under either reading and no rule on one market qualified. Of the
80 rests, 3 were more than 2 standard errors from zero (R50 Run hold, -2.15
and -2.18; ZD Turn hold against mirrored minutes, -2.00) and none more than
3; the best rule on one market had a smaller t of 2.39. The zones' lifts
stood off zero there as in Amendment 1's table (Z4 Turn quick: lift +2.85,
baselines +2.62 and +2.43, rests +0.23 and +0.42). The reading on the rest
finds nothing where there is nothing.

**Order of reading.** The status line of the choosing run (counts only), then
its placebo section, then its tables. The check ran after that.

### The answer (run 2026-11-18)

**Price did not turn at these levels more than at nearby prices. No rule was
chosen, and a quick order placed at a level lost money before costs in all
ten kinds.** One rule on one market qualified under the plan's own reading (not
under Amendment 1's), so the single check ran for it: on USD/JPY, a break of
yesterday's high or low runs on more often than a break of a nearby price.
Its reading on 2019 to 2025 is **"Real but too small to trade"**: the level
lines held on the unseen years against both kinds of prices with no memory,
and the trade that goes with the break lost 0.07 R a trade after costs.

John's questions, on 2005 to 2018 and seven markets:

- **Do the floors and ceilings of the bigger charts turn price?** Not more
  than prices with no memory do. A 4-hour zone that had turned price three
  times or more was visited 938 times. At the quick distance 57.6 of 100
  visits turned against 55.3 at nearby prices (+2.33, t 1.08), and prices
  with no memory give +1.96 and +2.64 from the way a zone is built, so
  nothing is left (+0.36 and -0.31). At the hold distance it was 52.8 against
  45.2 (+7.56), of which +3.88 and +3.54 is the build; what is left (+3.68
  and +4.01) is 1.2 standard errors: "not seen at 9.6 points or more". 938
  visits in fourteen years cannot show less than that. On 2019 to 2025, as
  description only, the quick lift was -4.43 and the hold lift +4.77. Daily
  zones (228 visits) turned price less often than nearby prices (59.7 against
  67.1). More turns did not make a zone stronger: quick lift with two turns
  -2.8 (4,843 visits), three +3.1 (696), four or more -5.0 (178); daily +2.4
  (1,162), -6.0 (164), -12.5 (43). These splits have no baseline of their
  own, and for the two-turn zones Placebo 1 lay outside its limit (cause
  found in part, see below).
- **Round numbers and yesterday's high and low** turned price less often
  than nearby prices: 48.0 of 100 against 50.3 at the 00 levels (-2.36, t
  -7.8, in all seven markets), 49.0 against 50.3 at the 50 levels (-1.28, t
  -5.1, in five of the seven), 47.7 against 50.5 at yesterday's high and low
  (-2.78, t -6.6, in all seven). Prices with no memory show nothing of the kind, and 2019 to 2025
  showed it again (-2.46, -1.76, -2.31). Last week's high and low: 49.3
  against 49.8.
- **How far a turn goes.** The quick distance was 27 to 39 pips on average
  and the hold distance 107 to 154. Where price turned at the quick distance,
  the median distance it then went was 53 to 85 pips.
- **The plain trades.** The order at the level (T0, quick) lost 1.3 to 5.3
  pips a trade before costs in all ten kinds, and 2.7 to 6.9 after. All kinds
  together, after costs: T0 -0.110 R (136,410 trades), T1 -0.092 R (85,399),
  B0 -0.102 R (103,194).
- **What waiting for the close back out adds.** T1 lost less than T0 in nine
  of the ten kinds (yesterday's high and low: T0 -0.136 R, T1 -0.107 R; the
  classic daily Fibonacci levels: T0 -0.168 R, T1 -0.044 R) and still lost
  in every one.
- **Quick against hold.** No difference: T0 -0.110 R quick and -0.111 R hold;
  T1 -0.092 R and -0.088 R; B0 -0.102 R and -0.082 R.
- **Fibonacci.** Nothing. Quick Turn lifts: F4C -1.9 (t -1.87), FDC 0.0, F4J
  -2.6 (prices with no memory give -3.1 and -2.6 for John's 0.786 to 0.886
  area, so the rest is +0.5 and 0.0), FDJ -0.2.
- **The best pair.** None under Amendment 1's reading. Under the plan's own:
  USD/JPY, breaks of yesterday's high or low. Real, and too small to trade.
- **Pairs that move alike.** EUR/JPY and GBP/JPY are close to one bet: their
  daily changes move together 0.82 (2005 to 2011), 0.74 (2012 to 2018) and
  0.76 (2019 to 2025). USD/JPY and GBP/JPY reached 0.71 in 2005 to 2011 only;
  EUR/USD and GBP/USD 0.66, 0.56 and 0.70.

### What was run

- **The choosing run**: commit efb2339, the development copies of the seven
  files (they end on 2018-12-31), 2005 to 2018 (gold from 2009). 142,658
  visits to the ten kinds: R00 44,843; R50 49,088; PD 26,785; PW 12,985; Z4
  938; ZD 228; F4C 4,390; FDC 880; F4J 2,098; FDJ 423; and 5,132 and 1,290 to
  the two-turn zones of the 4-hour and the daily chart. Trades in the ten
  kinds: T0 136,410, T1 85,399, B0 103,194. Twenty series with no memory, all
  kinds built on each.
- **The check**, once: the marker was written on 2026-11-18 at 21:34 UTC,
  before any bar from 2019 on was read. The full files had the hashes taken
  before the builds. One pick. Settled before 2019: 165,557 visits with their
  trades and the twins' sums compared with the choosing run, 0 differences.
  The twenty series were built again on the whole files inside the check.
- **Files**: `~/.local/share/trade-hub/levels-results/choose` and
  `~/.local/share/trade-hub/levels-results/check` on the Mac Mini (not in
  git): `choose.md` and `check.md` hold every table of this page's parts; the
  json files hold every number, each series' lifts included, so any rest can
  be worked out again.

### The placebos, read first

Everything in them is covered by the causes written in Amendment 1.

**Placebo 1** is the same as in the practice runs: every kind inside, and the
two-turn zones of the 4-hour chart outside (Z4x2 +2.33, standard error 0.74,
limit 1.86). The cause is the one written there, found in part. Nothing is
chosen from two-turn zones.

**Placebo 2**, shuffled days with seed 1 (after the fix of point 30, so not
the shuffle of the practice runs), lay outside 2.5 standard errors of zero in
seven cells. Beside each, the mean and the spread of the ten shuffles and of
the ten mirrored series say which of the three written causes it is:

- **Chance of this one shuffle**: R00 turn 1.00 (+0.79; ten shuffles -0.02,
  spread 0.41; mirrored +0.01) and F4C turn 1.00 (+3.05; ten shuffles +0.47,
  spread 1.20; mirrored -0.76). In the practice runs it was R50 and F4C at
  the same distance. The spread between shuffles is again wider than one
  shuffle's standard error there.
- **The shuffled series itself**: PD turn 0.10 (-0.89), turn 0.25 (-1.18) and
  run 0.25 (+1.25); the ten shuffles agree (-0.64, -0.49, +0.57) and the
  mirrored series show nothing (-0.04, +0.09, -0.20).
- **How the kind is built**: Z4 turn 1.00 (+6.72; ten shuffles +3.88,
  mirrored +3.54) and F4J turn 0.10 (-3.05; -3.96 and -2.99).

The means of the ten series stand off zero where Amendment 1's table says
they would: the zones (Z4, ZD, Z4x2, ZDx2), FDC and F4J, in both kinds of
prices with no memory, and PD on shuffled days only. One mark falls outside
that list, R00 run 0.25 on shuffled days (-0.22, spread 0.26), which is the
size chance gives among 120 means.

### Parts 1 to 3: the choosing years in one table

All markets, 2005 to 2018. "Turned" is out of 100 visits that turned or broke
at the quick distance (0.25 x ATR, 24 hours). Pips are a trade's average.

| Kind | Visits | Turned: at the level / at nearby prices | Lift | Prices with no memory give: shuffled days / mirrored minutes | Median pips a turn went | T0 quick, pips before / after costs | T1 quick, before / after |
| ---- | ------ | --------------------------------------- | ---- | ------------------------------------------------------------ | ----------------------- | ----------------------------------- | ------------------------ |
| R00  | 44,843 | 48.0 / 50.3                             | -2.4 | +0.1 / +0.0                                                  | 80.0                    | -2.4 / -3.9                         | -1.9 / -3.5              |
| R50  | 49,088 | 49.0 / 50.3                             | -1.3 | -0.1 / +0.1                                                  | 85.1                    | -1.9 / -3.5                         | -1.1 / -2.9              |
| PD   | 26,785 | 47.7 / 50.5                             | -2.8 | -0.5 / +0.1                                                  | 59.7                    | -2.3 / -3.7                         | -1.0 / -2.6              |
| PW   | 12,985 | 49.3 / 49.8                             | -0.5 | -0.0 / +0.3                                                  | 59.0                    | -1.3 / -2.7                         | -0.8 / -2.5              |
| Z4   | 938    | 57.6 / 55.3                             | +2.3 | +2.0 / +2.6                                                  | 53.0                    | -3.5 / -4.8                         | -2.7 / -4.2              |
| ZD   | 228    | 59.7 / 67.1                             | -7.4 | +3.9 / +5.1                                                  | 61.9                    | -5.3 / -6.9                         | -3.6 / -5.4              |
| F4C  | 4,390  | 48.9 / 50.7                             | -1.9 | -0.2 / -0.0                                                  | 62.3                    | -1.5 / -2.9                         | +0.2 / -1.4              |
| FDC  | 880    | 48.9 / 48.9                             | -0.0 | +0.6 / +1.9                                                  | 61.5                    | -3.7 / -5.2                         | -1.2 / -2.9              |
| F4J  | 2,098  | 61.1 / 63.7                             | -2.6 | -3.1 / -2.6                                                  | 58.5                    | -1.5 / -2.9                         | +0.2 / -1.4              |
| FDJ  | 423    | 75.7 / 76.0                             | -0.2 | +1.0 / +0.3                                                  | 58.9                    | -1.8 / -3.2                         | -0.3 / -2.0              |

Fifteen minutes after a touch the close was back on the near side of the
level less often than at nearby prices too (R00 51.6 of 100 against 54.3; PD
51.4 against 55.0; Z4 46.9 against 52.1).

**The trades, cell by cell.** Part 3 has 480 cells for the ten kinds (each
kind, on all markets and on each market, three trades, quick and hold). 68
were above zero after costs. Of those, 15 had 200 trades or more, and the
steadiest of them had a weekly t of 1.29 (last week's high and low on
EUR/USD, with the break, hold: +0.067 R on 1,394 trades). On all markets
together three cells were above zero after costs, none of them steady (FDJ T0
hold +0.043 R on 410 trades, weekly t 0.72; ZD B0 hold +0.158 R on 87 trades;
F4C T1 hold +0.005 R). No lead is taken from these tables.

### Part 4: choosing and the single check

**Choosing, 2005 to 2018.** None of the forty rules was chosen, on the rest
or as written. In the table a rule's "decided visits" are the ones that ended
in a turn or a break (for a Run rule: a run or a fail).

| Rule           | Decided visits | Lift (t)      | Prices with no memory give: shuffled days / mirrored minutes | What is left, the rest (t): against shuffled days / against mirrored minutes | 2019 to 2025: lift | 2019 to 2025: the rest, shuffled / mirrored | 2019 to 2025: markets above zero |
| -------------- | -------------- | ------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------ | ------------------------------------------- | -------------------------------- |
| R00 Turn quick | 43,324         | -2.36 (-7.83) | +0.10 / +0.02                                                | -2.46 (-7.83) / -2.38 (-6.97)                                                | -2.46              | -2.52 / -2.49                               | 0                                |
| R00 Turn hold  | 33,773         | -0.18 (-0.55) | -0.02 / +0.01                                                | -0.16 (-0.37) / -0.19 (-0.52)                                                | +0.16              | +0.34 / +0.26                               | 4                                |
| R00 Run quick  | 31,248         | +0.48 (1.41)  | -0.22 / -0.11                                                | +0.70 (2.01) / +0.59 (1.32)                                                  | +0.34              | +0.34 / +0.48                               | 5                                |
| R00 Run hold   | 24,403         | -0.52 (-1.56) | -0.13 / -0.14                                                | -0.39 (-1.14) / -0.38 (-1.11)                                                | -0.72              | -0.99 / -0.83                               | 1                                |
| R50 Turn quick | 47,365         | -1.28 (-5.13) | -0.05 / +0.10                                                | -1.23 (-4.84) / -1.38 (-4.24)                                                | -1.76              | -1.73 / -1.88                               | 2                                |
| R50 Turn hold  | 36,900         | -0.45 (-1.68) | +0.11 / +0.05                                                | -0.56 (-2.02) / -0.50 (-1.29)                                                | -0.59              | -0.54 / -0.52                               | 2                                |
| R50 Run quick  | 34,027         | -0.32 (-1.10) | +0.00 / -0.06                                                | -0.32 (-0.90) / -0.26 (-0.86)                                                | +0.50              | +0.65 / +0.61                               | 5                                |
| R50 Run hold   | 26,618         | +0.26 (0.96)  | -0.15 / -0.11                                                | +0.41 (1.42) / +0.37 (1.17)                                                  | -0.15              | -0.20 / -0.23                               | 2                                |
| PD Turn quick  | 25,924         | -2.78 (-6.62) | -0.49 / +0.09                                                | -2.29 (-5.30) / -2.87 (-5.82)                                                | -2.31              | -1.77 / -2.56                               | 0                                |
| PD Turn hold   | 20,137         | +0.17 (0.28)  | -0.01 / +0.23                                                | +0.17 (0.29) / -0.06 (-0.08)                                                 | -0.61              | -0.91 / -0.34                               | 1                                |
| PD Run quick   | 18,829         | +2.33 (4.66)  | +0.57 / -0.20                                                | +1.76 (3.37) / +2.53 (4.93)                                                  | +2.88              | +2.19 / +3.13                               | 7                                |
| PD Run hold    | 14,559         | -0.77 (-1.31) | -0.05 / +0.08                                                | -0.73 (-1.21) / -0.86 (-1.34)                                                | -0.06              | +0.05 / -0.05                               | 4                                |
| PW Turn quick  | 12,594         | -0.51 (-0.94) | -0.04 / +0.34                                                | -0.47 (-0.85) / -0.85 (-1.49)                                                | -0.89              | -0.85 / -1.22                               | 2                                |
| PW Turn hold   | 9,806          | +1.31 (1.80)  | +0.30 / +0.32                                                | +1.01 (1.33) / +0.99 (1.31)                                                  | +1.10              | +0.93 / +0.54                               | 4                                |
| PW Run quick   | 8,987          | +1.40 (2.38)  | +0.03 / -0.38                                                | +1.38 (2.26) / +1.78 (2.91)                                                  | +1.09              | +1.42 / +1.61                               | 5                                |
| PW Run hold    | 6,953          | -2.44 (-3.15) | -0.50 / -0.31                                                | -1.94 (-2.10) / -2.13 (-2.67)                                                | -1.45              | -1.17 / -0.63                               | 3                                |
| Z4 Turn quick  | 875            | +2.33 (1.08)  | +1.96 / +2.64                                                | +0.36 (0.16) / -0.31 (-0.14)                                                 | -4.43              | -5.34 / -6.85                               | 1                                |
| Z4 Turn hold   | 691            | +7.56 (2.48)  | +3.88 / +3.54                                                | +3.68 (1.17) / +4.01 (1.26)                                                  | +4.77              | +2.37 / +6.26                               | 5                                |
| Z4 Run quick   | 483            | -0.77 (-0.27) | -1.23 / -0.85                                                | +0.46 (0.16) / +0.08 (0.03)                                                  | +3.32              | +5.16 / +6.64                               | 5                                |
| Z4 Run hold    | 384            | -2.35 (-0.81) | -2.93 / -4.37                                                | +0.58 (0.19) / +2.03 (0.67)                                                  | -5.65              | -0.68 / -6.17                               | 1                                |
| ZD Turn quick  | 207            | -7.41 (-1.62) | +3.88 / +5.13                                                | -11.30 (-2.42) / -12.54 (-2.28)                                              | -2.85              | -7.16 / -8.08                               | 3                                |
| ZD Turn hold   | 144            | -3.44 (-0.48) | +7.81 / +8.70                                                | -11.25 (-1.50) / -12.13 (-1.44)                                              | -0.03              | -6.62 / -2.35                               | 2                                |
| ZD Run quick   | 85             | +2.57 (0.33)  | -2.00 / -3.29                                                | +4.57 (0.57) / +5.86 (0.67)                                                  | +8.58              | +10.79 / +8.47                              | 4                                |
| ZD Run hold    | 71             | +0.73 (0.11)  | -5.13 / -6.95                                                | +5.86 (0.84) / +7.68 (0.99)                                                  | -10.32             | +0.50 / -5.54                               | 0                                |
| F4C Turn quick | 4,294          | -1.89 (-1.87) | -0.16 / -0.01                                                | -1.73 (-1.68) / -1.88 (-1.83)                                                | +2.11              | +2.51 / +2.02                               | 6                                |
| F4C Turn hold  | 3,327          | -0.61 (-0.48) | +0.47 / -0.76                                                | -1.08 (-0.82) / +0.15 (0.10)                                                 | +0.62              | +0.99 / +0.38                               | 5                                |
| F4C Run quick  | 3,096          | +2.02 (1.76)  | +0.35 / -0.01                                                | +1.68 (1.08) / +2.03 (1.73)                                                  | -2.88              | -3.59 / -2.70                               | 1                                |
| F4C Run hold   | 2,416          | +0.80 (0.55)  | -0.86 / +0.41                                                | +1.66 (1.10) / +0.39 (0.25)                                                  | -1.27              | -1.92 / -0.86                               | 2                                |
| FDC Turn quick | 851            | -0.02 (-0.01) | +0.57 / +1.91                                                | -0.59 (-0.31) / -1.93 (-1.01)                                                | +2.08              | +0.94 / +0.84                               | 5                                |
| FDC Turn hold  | 643            | +4.39 (2.17)  | +1.64 / +2.99                                                | +2.75 (1.33) / +1.40 (0.67)                                                  | +4.28              | +1.59 / +1.37                               | 6                                |
| FDC Run quick  | 598            | +0.71 (0.34)  | -1.17 / -2.10                                                | +1.89 (0.78) / +2.82 (1.30)                                                  | -1.03              | -0.30 / -1.93                               | 2                                |
| FDC Run hold   | 447            | -3.72 (-1.61) | -1.70 / -2.57                                                | -2.02 (-0.85) / -1.14 (-0.48)                                                | -4.96              | -2.84 / -2.60                               | 1                                |
| F4J Turn quick | 1,947          | -2.62 (-1.76) | -3.08 / -2.61                                                | +0.46 (0.24) / -0.00 (-0.00)                                                 | -4.39              | -1.87 / -1.87                               | 1                                |
| F4J Turn hold  | 1,446          | -0.75 (-0.43) | -1.37 / -0.48                                                | +0.62 (0.35) / -0.27 (-0.13)                                                 | -0.29              | +0.91 / +0.02                               | 4                                |
| F4J Run quick  | 958            | +2.21 (1.12)  | +1.14 / +0.43                                                | +1.06 (0.44) / +1.78 (0.75)                                                  | +2.68              | +2.38 / +2.67                               | 3                                |
| F4J Run hold   | 738            | -1.43 (-0.57) | -0.01 / -1.35                                                | -1.42 (-0.55) / -0.08 (-0.03)                                                | -1.54              | -1.38 / -0.71                               | 2                                |
| FDJ Turn quick | 338            | -0.23 (-0.08) | +1.03 / +0.33                                                | -1.26 (-0.41) / -0.56 (-0.18)                                                | +0.16              | +0.03 / -2.29                               | 4                                |
| FDJ Turn hold  | 253            | -0.83 (-0.23) | +1.20 / +2.08                                                | -2.03 (-0.55) / -2.91 (-0.77)                                                | -2.85              | -3.40 / -7.01                               | 3                                |
| FDJ Run quick  | 123            | +9.08 (1.23)  | -0.38 / +0.36                                                | +9.47 (1.25) / +8.72 (1.14)                                                  | +16.51             | +18.37 / +18.60                             | 5                                |
| FDJ Run hold   | 94             | -3.14 (-0.38) | -2.64 / -2.25                                                | -0.50 (-0.06) / -0.89 (-0.10)                                                | +8.11              | +7.49 / +12.80                              | 4                                |

Sixteen of the 80 rests are more than 2 standard errors from zero (the
control run on prices with no memory had 3). Eight of them are past 3, all in
four rules: R00, R50 and PD Turn quick below zero, and PD Run quick above
it. So the real market is not prices with no memory, and what it does at the
plainest levels is the opposite of holding: price goes through a 00 level and
through yesterday's high or low more often than through a nearby price.

**The nearest miss** is PD Run quick: after a break of yesterday's high or
low, price ran on a further quarter of the daily range (instead of failing
back) 51.4 times in 100 against 49.1 at nearby prices, in all seven markets
and in both halves (+2.33, t 4.66). Against mirrored minutes it holds all four
lines (+2.53, t 4.93). Against shuffled days it holds three and misses the
first by a quarter of a point (+1.76 against the bar of 2; t 3.37). As written
it is read on the rest of seed 1 (+1.08) and is not chosen either. It did not
go to the check, so it has no reading. As description, on 2019 to 2025 its
lift was +2.88, above zero in all seven markets, with rests of +2.19 and
+3.13.

**The pair candidate.** Of the 280 rules on one market, none qualified on the
rest. One qualified as written: **USD/JPY, PD Run quick**, with 3,038 decided
visits, 52.5 runs in 100 against 48.2 (+4.32, t 3.96, halves +5.25 and
+3.45). On the rest it is +3.65 (t 3.28) against shuffled days and +4.99 (t
4.36) against mirrored minutes, so it misses the 4 points and the t of 3.5
against the first. Under reading 3 above its as-written lines are on the plain
lift. Had they been put on the rest of seed 1, as the plan does for the
choosing bar, it would not have qualified (+4.32 less +1.98 is +2.34). Point F
sends it to the check as chosen "as written only", and the words it gets
there come from the level lines on the rest.

**The check, 2019 to 2025.** One rule and one rule and trade pair were taken,
so line P2 asks for a weekly t of 2.5.

| USD/JPY, PD Run quick             | 2005 to 2018 | 2019 to 2025                 |
| --------------------------------- | ------------ | ---------------------------- |
| Decided visits                    | 3,038        | 1,403                        |
| Runs in 100: level / nearby       | 52.5 / 48.2  | 56.1 / 48.7                  |
| Lift (t)                          | +4.32 (3.96) | +7.44 (4.69)                 |
| Shuffled days give (spread)       | +0.66 (0.70) | +1.62 (1.34)                 |
| Rest against shuffled days (t)    | +3.65 (3.28) | +5.83 (3.55): L1 and L2 hold |
| Mirrored minutes give (spread)    | -0.67 (1.08) | -0.73 (1.12)                 |
| Rest against mirrored minutes (t) | +4.99 (4.36) | +8.17 (5.02): L1 and L2 hold |
| B0 quick: trades                  | 3,175        | 1,478 (P1 holds)             |
| Target first                      | 47.4%        | 47.6%                        |
| Average before costs              | +0.003 R     | -0.009 R, -0.8 pips          |
| Average after costs               | -0.058 R     | -0.073 R, -2.0 pips          |
| At double cost                    |              | -0.136 R (P5 fails)          |
| Weekly t                          | -3.18        | -2.48 (P2 fails)             |
| Years above zero                  |              | 1 of 7, only 2025 (P3 fails) |
| Gap to its twins (t)              | +0.091 R     | +0.138 R (4.19) (P4 holds)   |

By year, in R: 2019 -21.6, 2020 -1.4, 2021 -6.8, 2022 -7.6, 2023 -25.9, 2024
-51.7, 2025 +7.6; in all -107.3 R on 1,478 trades.

**"Real but too small to trade"**, under Amendment 1's reading and under the
plan's own. The level lines hold on years the choice never saw, more strongly
than on the choosing years, and against both kinds of prices with no memory.
The trade that goes with the break breaks even before costs and loses after
them: it is far better than the same trade at a nearby price (the gap) and
still not a way to make money. No note on the Run rule applies: the
Turn reading at the same distance is below zero.

**Did choosing carry information?** Of the forty rules, 17 had a lift above
zero on 2019 to 2025, and 17 a smaller rest above zero. The rank correlation
of the forty lifts between the two periods is 0.44 (on the smaller rest:
0.44). What carried over is the picture above: R00, R50 and PD Turn quick
below zero again (-2.46, -1.76 and -2.31; R00 and PD in no market above
zero), PD Run quick above it again. The zones and the Fibonacci levels did
not carry over (Z4 Turn quick +2.33 then -4.43; F4C Turn quick -1.89 then
+2.11).

### Part 5: pairs that move alike

Daily changes, correlation by period (2005 to 2011, 2012 to 2018, 2019 to
2025); the 4-hour figures are within 0.06 of these.

| Pair                | 2005 to 2011 | 2012 to 2018 | 2019 to 2025 |
| ------------------- | ------------ | ------------ | ------------ |
| EUR/JPY and GBP/JPY | 0.82         | 0.74         | 0.76         |
| USD/JPY and GBP/JPY | 0.71         | 0.68         | 0.57         |
| EUR/USD and GBP/USD | 0.66         | 0.56         | 0.70         |
| EUR/JPY and USD/JPY | 0.65         | 0.64         | 0.67         |
| GBP/USD and GBP/JPY | 0.66         | 0.62         | 0.52         |
| EUR/USD and EUR/JPY | 0.62         | 0.52         | 0.33         |
| GBP/USD and EUR/GBP | -0.36        | -0.51        | -0.58        |
| USD/JPY and gold    | -0.17        | -0.39        | -0.39        |

EUR/JPY and GBP/JPY are close to one bet in every period. Gold is not close
to any of the six (0.39 at most, either way).

### What it means

- **The idea as John put it does not show up in these prices.** A level that
  "turns price back every time it gets there" would have a Turn lift well
  above what prices with no memory give. No kind has one. The zones look like
  it on a chart because any price that was a turning point three times looks
  like a floor afterwards; made-up prices with no memory produce the same
  picture and the same 2 to 4 points.
- **The plainest levels do the opposite.** At a 00 level and at yesterday's
  high and low, price went through more often than at a nearby price, on both
  periods. Fading them is worse than fading a random price.
- **One thing is real, and small.** A break of yesterday's high or low runs
  on more often than a break of a nearby price: in all seven markets, on both
  periods, most on USD/JPY. It is worth 2 to 3 runs in 100 across the seven
  markets and 4 to 7 on USD/JPY. A plain trade with the break breaks even
  before costs and loses after them.
- **By this page's own rule the confirmations are not tested.** "What comes
  after" was only for rules whose level lines hold as turning points. None
  does.
- **If anything here is taken further**, it is the break of yesterday's high
  or low as a condition inside another rule (never fade it; lean with it),
  not as a trade of its own. That would be a new plan, written before its
  code, on data this study has not used for choosing. Nothing is started.
- **The method lesson.** A comparison with nearby prices is not neutral for
  levels made from past turning points. Every such test needs prices with no
  memory beside it, several series of them, before a single real table is
  read. Without that step the tables would have shown 4-hour zones turning
  price 8 points more often at the hold distance, about half of which is the
  way a zone is built.

Limits as said in advance, and two more. The years 2019 to 2025 have now been
opened once for this study, for one candidate; the figures of the other
thirty-nine rules on those years are description and carry no reading. And
the one candidate reached the check through the plan's own reading of the
pair candidate, which Amendment 1 would not have passed; the check's answer
does not depend on that, since its level lines hold against both baselines.

Play money only. No broker is connected. This is not financial advice.
