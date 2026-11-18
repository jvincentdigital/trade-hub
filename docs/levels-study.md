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

## Results

Not run yet.
