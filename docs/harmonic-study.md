# Harmonic patterns (the Butterfly family): plan

Lab study, play money only. **Plan written 2026-11-17 before any result of
this study was computed.** Two reviewers read a draft; their findings are
folded in (no peeking inside the confirming candle, exact rules for sells,
swings and indicators, a harder pass bar, a luck test that keeps the market's
drift, price-scaled gold costs). Results go at the bottom; the plan above
them is not edited.

## Why

John remembered a method he used to see: a five-point zigzag on 15 and 30
minute charts called the Butterfly, confirmed with RSI and an EMA. He asked
(2026-11-17) to test it on our history: when the patterns appeared, would a
trade have been possible, did it pay, does it pay more when one of our own
confirmations agrees, and how far does price travel afterwards, to find the
profit target worth aiming for.

Said in advance: this is a close cousin of the Fibonacci pullback this lab
already tested (John's own 0.786 and 0.886 levels are this family's levels),
and that one lost after costs. The question is whether the extra structure
of the five points, the confirmations and a better target change that.

## Data

- 1-minute HistData files with the repaired clock (clock-trades study,
  Amendment 1): EUR/USD and GBP/USD 2005 to 2025, gold 2009 to 2025. Prices
  are the Bid.
- **Choosing years: 2010-01-01 to 2018-12-31. Checking years: 2019-01-01 to
  2025-12-31.** A trade belongs to the period of its fill minute (UTC).
- Charts: 15-minute and 30-minute candles built from the 1-minute files on
  UTC clock boundaries. A chart candle exists if it has at least one 1-minute
  candle. Every count of candles below counts existing candles. Swings and
  indicators run over each whole file from its first candle, with no reset at
  weekends, gaps or year ends, and use closed candles only.

## Order of work (so the checking years cannot leak into the code)

1. Unit tests, the second pattern finder and any fix use 2010 to 2018 only.
2. The code is committed and pushed; the commit is named in the results.
3. Only then is anything from 2019 or later computed, once. The runner writes
   a marker and refuses to repeat. Part 1's counts for 2019 to 2025 are
   computed only after that check.

## Finding the pattern, with no knowledge of the future

**Swings.** True range = max(high, previous close) - min(low, previous
close). ATR at candle `i` = the mean of the true ranges of candles `i-13` to
`i`. No swing is confirmed before 14 true ranges exist. With a size `k` (2 or
3):

- Start with a high forming, the first candle's high as the candidate.
- While a high is forming: a candle whose high is strictly higher than the
  candidate becomes the candidate and does nothing else (on a tie the earlier
  candle stays). Otherwise, if the candle's low is at or below the candidate
  minus `k` times the ATR at that candle, the high is **confirmed at that
  candle's close**. The candidate low is then the lowest low of the candles
  after the high's candle through the confirming candle (the earliest on a
  tie), and the search for the low's confirmation starts at the next candle.
- Lows mirror this. A candle confirms at most one swing.
- A swing exists only from the moment it is confirmed. Nothing in the study
  may use a swing before that moment.

**The four points.** Each time a swing C is confirmed, X, A and B are the
three confirmed swings before it. Swings and ratios always use Bid highs and
lows. Ratio tests are inclusive, with a tolerance of 1e-9.

|                            | Buy pattern                  | Sell pattern                 |
| -------------------------- | ---------------------------- | ---------------------------- |
| Points                     | X low, A high, B low, C high | X high, A low, B high, C low |
| XA                         | A - X                        | X - A                        |
| rB                         | (A - B) / XA                 | (B - A) / XA                 |
| rC, must be 0.382 to 0.886 | (C - B) / (A - B)            | (B - C) / (B - A)            |
| D, where it should end     | A - d x XA                   | A + d x XA                   |
| Stop                       | A - s x XA                   | A + s x XA                   |
| proj, must be in range     | (C - D) / (C - B)            | (D - C) / (B - C)            |

| Pattern   | rB             | d     | s     | proj           |
| --------- | -------------- | ----- | ----- | -------------- |
| Gartley   | 0.568 to 0.668 | 0.786 | 1.05  | 1.27 to 1.618  |
| Bat       | 0.382 to 0.5   | 0.886 | 1.13  | 1.618 to 2.618 |
| Butterfly | 0.736 to 0.836 | 1.27  | 1.414 | 1.618 to 2.618 |
| Crab      | 0.382 to 0.618 | 1.618 | 2.0   | 2.24 to 3.618  |

Every pattern that qualifies is its own trade. One C can give two (Gartley
and Crab, or Bat and Crab), and trades may overlap in time on the same
market.

**Nothing inside the confirming candle counts.** A buy pattern is skipped if
the candidate low at C's confirmation (the lowest Bid low from the candle
after C's candle through the confirming candle) is at or below D; a sell
pattern if the matching high is at or above D. The wait, the order at D and
every later check start with the first 1-minute candle stamped at or after
the confirming candle's close.

**The wait.** Checked on 1-minute Bid candles in time order. With `pen` = 0.5
pip (gold $0.05):

- A buy pattern **completes** in the first minute whose Bid low is at or
  below D - spread - pen (the Ask went through D). A sell pattern completes
  in the first minute whose Bid high is at or above D + pen.
- It is cancelled by a minute whose Bid high is above C (sells: Bid low below
  C); a minute that does both is a cancel. It is also cancelled at the close
  of the 192nd chart candle after the confirming candle, and at the close of
  the candle that confirms the next swing after C if it has not completed by
  then.

## Taking the trade

**Prices and costs.** Ask = Bid + spread. Spread: EUR/USD 0.00008, GBP/USD
0.00010, gold $0.28 times the entry price divided by $1,800 (fixed for the
life of the trade). Gold also pays $0.07 an ounce. A pip is 0.0001 for the
currency pairs and $0.10 for gold. Market entries, stop fills and time exits
lose a further 0.2 pip. The round-trip cost of a trade is its spread (plus
$0.07 for gold). Every result is also shown at double cost (spread, gold's
$0.07 and the 0.2 pip all doubled).

**Entries.** Six ways, each tested on its own. Buys enter at the Ask, sells
at the Bid.

- **E0, at D:** an order waiting at D. It fills in the completing minute at
  D, never at a better price.
- **C1, RSI and EMA** (the method as John remembers it). Candle 1 is the
  chart candle that contains the completing minute. The trigger is the first
  of candles 1 to 12 that closes above the EMA(20) (sells: below), provided
  RSI(14) was at or below 30 (sells: at or above 70) at the close of some
  candle from candle 1 through the trigger. Entry at the open of the next
  chart candle, at market.
- **C2, reversal candle:** as C1, but the trigger is a candle with a range
  whose close is above the previous candle's high and at or above its own low
  plus two thirds of its range (sells: close below the previous low and at or
  below the low plus one third of the range).
- **C3, with the bigger trend:** E0, only when the latest 4-hour candle that
  ended at or before the confirming candle's close closed above its EMA(50)
  (sells: below). 4-hour candles start at 17, 21, 01, 05, 09 and 13 New York
  time.
- **C4, London and New York hours:** E0, only when the fill minute is stamped
  03:00 to 11:59 New York time.
- **C5:** C3's trend test, then C1's entry.

RSI(14) is Wilder's: the first value uses plain averages of the first 14
gains and losses, then average = (previous x 13 + new) / 14. EMA(20) uses
2/21 and EMA(50) uses 2/51, each seeded with its file's first close.

For C1, C2 and C5: the wait is cancelled if any 1-minute Bid from the
completing minute through the trigger candle's close reaches the stop or X1's
target. The trade is skipped if a buy's entry Ask is at or above X1's target
or its entry Bid is at or below the stop (sells mirrored).

**Stop and risk.** Every entry uses the pattern's stop level. R is the risk
of a trade: entry Ask minus stop for a buy, stop minus entry Bid for a sell.
A trade is skipped when R is under 5 times its round-trip cost. Skips apply
to every exit, so all seven exits share one list of trades. Skipped trades
are counted and reported.

**How fills are decided,** on 1-minute candles:

- A buy's stop is hit when the Bid low is at or below it; a sell's when the
  Bid high plus the spread is at or above it. It fills at the stop, or at the
  minute's open when the open is already beyond it, less the 0.2 pip.
- A buy's target is hit when the Bid high is at or above it; a sell's when
  the Bid low plus the spread is at or below it. It fills at the target.
- In the fill minute only the stop is checked. From the next minute on, if a
  stop and a target are both inside one minute, the stop counts.
- Trades stay open over the weekend.

**Exits.** Seven ways, each tested on its own, all with the stop:

- **X1:** target at D + 0.382 x (A - D) (sells: D - 0.382 x (D - A)).
- **X2:** the same with 0.618.
- **X3:** half at X1's target, then the stop of the rest moves to the entry
  price and the rest goes for X2's target.
- **X4 to X7:** target at 1, 1.5, 2 and 3 times R from the entry.

A trade still open at the first minute of the 481st chart candle, counting
the fill candle as the first, is closed there at market.

**Counting.** A trade's result is in R, after costs. The t-statistic is the
average of weekly sums of R (all markets of the version together, weeks with
no trade left out) divided by its standard error, so trades that overlap or
share a C are not counted as independent.

## Part 1: how often the patterns appear

Per market, chart, year and pattern: how many formed, completed and were
cancelled, and how many C's gave two patterns. The years 2019 to 2025 are
added only after the check.

## Part 2: the look-back John asked for

Choosing years only, entry E0, per market and for all three together. For
every filled trade, with the stop in place:

- the furthest price went in the trade's favour and the furthest against it,
  from the minute after the fill to the stop or the time exit, in R and in
  pips, always shown side by side;
- how many trades reached 0.5, 1, 1.5, 2 and 3 R before the stop, and what
  each of those targets would have made on average after costs, with its
  weekly t-statistic;
- what the trade was worth at the first minute at or after 4, 12, 24 and 48
  hours from the fill, stop in place.

The "sweet spot" is the target with the highest average result after costs.
Fixed wording: if every target is at or below zero after costs, the table
says **"no target made money; the best row is the least-losing one, not a
sweet spot"**. Either way it describes 2010 to 2018 and nothing more until
Part 4.

## Part 3: do our confirmations help?

Choosing years only: the same table for C1 to C5 next to E0.

## Part 4: one rule, chosen on the old years and checked on the new ones

**Choosing.** 336 versions: patterns (Butterfly alone; all four) x chart (15,
30 minutes) x swing size (2, 3) x entry (6) x exit (7), the three markets
together. A version qualifies with at least 300 trades over 2010 to 2018 and
an average result above zero after costs in both 2010 to 2014 and 2015 to 2018. Qualifying versions are ranked by their weekly t-statistic over 2010 to 2018. **The first is the candidate.** The next four are listed for
description only.

If no version qualifies, the study ends there: **"it did not make money even
in the years used for choosing"**.

**Checking, once, on 2019 to 2025.** For the candidate: trades, average
result, weekly t-statistic, each year, each market, buys and sells, results
by size of R (smallest, middle and largest third), double cost, and 200
**twins**. A twin keeps every trade's market, direction, stop distance,
target distance and exit rule, but moves its entry by a random whole number
of days, 1 to 5 either way (the same move for all trades of one market
entered on one UTC date; if that minute does not exist, one more day the same
way, up to 4 times, else the trade is left out). Twins enter at market. They
keep whatever the market's own drift gave in those weeks and lose only the
pattern's timing. Seeds 1 to 200.

The candidate **passes** when, after costs, all hold:

1. at least 200 trades;
2. a weekly t-statistic of 2.5 or more;
3. at least 5 of the 7 years above zero;
4. ahead of at least 190 of its 200 twins;
5. still above zero at double cost;
6. at least two of the three markets above zero.

**Reading fixed now:**

- **"Worth a play account"**: the candidate passes. Before John is told so, a
  second implementation and two reviewers must fail to break it.
- **"Real but too small to trade"**: before costs the candidate clears 2 and
  4, but after costs it does not pass. No account is proposed.
- **"Not there"**: anything else.

Also reported, to show whether choosing carried information: how many of the
336 versions are above zero after costs in the checking years, and the rank
correlation between a version's result in the two periods.

## How the numbers are checked

- Unit tests on hand-made zigzags with known patterns, including: a swing is
  never used before its confirmation, and a confirming candle whose low
  passes D gives no pattern.
- A second person writes the pattern finder alone from this page. The two
  lists of patterns must match on GBP/USD 15-minute candles for 2015.

## Limits, said in advance

- 336 versions is a lot of trying. Some will look good in the choosing years
  by luck alone; the checking years are there to catch that.
- 2019 to 2025 are not blind to the lab: the Fibonacci pullback with these
  same levels failed there, and gold's rise in those years is known.
- The numbers that define each pattern are the commonly taught ones. Teachers
  differ, and a trader drawing by eye is looser than these rules. With C
  limited to 0.886, a Crab can only form with rB from 0.487 to 0.618, and the
  lower proj limits of the Bat and the Crab never bind.
- One free price feed; assumed costs; no overnight financing counted.
- Play money only. No broker is connected. This is not financial advice.

## Amendment 1: points made exact (2026-11-17, before any code was written)

The pushed plan was read once more the way the two programmers will read it.
Seven points could be read two ways, and one thing John asked for was
missing. Nothing has been computed.

1. **C1 and C5, the trigger.** The trigger is the first candle, among candles
   1 to 12, that closes above the EMA(20) at or after a candle (candle 1 or
   later) on which RSI(14) closed at or below 30. A close above the EMA before
   RSI has been that low is ignored. Sells: below the EMA, RSI at or above 70.
   This is the plain "RSI is low" form of the method. The form in which RSI
   fails to make a new low with the price is not tested.
2. **"Reaches"**, in the cancel rule for C1, C2 and C5, means the same tests
   as the stop and target fills.
3. **Gold's spread.** During the wait and for an order at D it is $0.28 x D /
   $1,800. For a market entry it is $0.28 x the Bid at entry / $1,800.
4. **Double cost and before costs use the same trades.** Nothing is simulated
   again. At double cost each result is lowered by one more round-trip cost
   and by one more 0.2 pip for every market fill the trade had (market entry,
   stop fill, time exit). Before costs, the round-trip cost and those 0.2
   pips are added back.
5. **Weeks** run from Saturday 00:00 UTC to the next, by fill minute. The
   standard error is the standard deviation of the weekly sums (n - 1)
   divided by the square root of the number of weeks.
6. **The choosing run reads no price after 2018-12-31.** A trade still open
   then is closed at market at the last minute of 2018. In the checking run
   the swings and indicators run over the whole file, and the trades are
   those filled from 2019-01-01 on.
7. **Twins.** A twin's stop and targets sit at the same price distances from
   its entry as the trade's did. It pays the entry slip its trade paid (none
   for an order at D). Its time exit counts from its own entry candle. "Ahead
   of a twin" means a higher average result per trade after costs.
8. **Parts 2 and 3, in pips as John asked.** Besides the targets in R, each
   market gets fixed targets of 5, 10, 15, 20, 30 and 50 pips (gold: $1, $2,
   $3, $5, $8 and $12), each with the pattern's stop: how many trades reached
   it and the average result after costs, in pips and in R. The same fixed
   wording applies. These are descriptions, not among the 336 versions.

## Amendment 2: John's pairs, longer holds and a middle answer (2026-11-17 night, before any code was written)

John read the summary of this plan and asked (2026-11-17) for three things:
to look first at whether the trades work and less at fees; to test on the
pairs he trades and find the pair where the method works best; and to see
what holding a position for days would have done. Nothing has been computed.

1. **Markets.** Four are added: USD/JPY, EUR/GBP, EUR/JPY and GBP/JPY, from
   the same source, 2005 to 2025, with the same clock repair and check. With
   EUR/USD, GBP/USD and gold that makes seven. A market whose file fails the
   clock check is left out and named in the results. Spreads: USD/JPY 0.9
   pip, EUR/GBP 1.0, EUR/JPY 1.3, GBP/JPY 2.0. A pip is 0.01 for the yen
   pairs. Where the plan says "the three markets", read "the markets used".
   Pass line 6 becomes: more than half of the markets used are above zero.
2. **The best pair.** The 336 versions are also run on each market alone. A
   version on one market qualifies with at least 150 trades over 2010 to 2018
   and an average result above zero after costs in both halves. The best by
   weekly t-statistic is the **pair candidate**. It is checked once on 2019
   to 2025, in the same single run as the candidate, with the same pass lines
   except line 6 and with 100 trades in place of 200. If no version on any
   one market qualifies, the results say so.
3. **Holding longer.** Parts 2 and 3 also show what a trade was worth 72 and
   120 hours after the fill, stop in place.
4. **Order of reporting.** Every table leads with how often the trade worked
   and how far price went, before costs, with the after-cost figure beside
   it. The choosing, the pass lines and the readings stay after costs.
5. **A middle answer.** A fourth reading, **"Positive, not proven"**: the
   candidate (or the pair candidate) does not pass, but after costs its
   average result on 2019 to 2025 is above zero and it is ahead of at least
   100 of its 200 twins. In those words it may be offered to John for a
   play-money account as the next test, never as a proven rule. The readings
   are tried in this order: worth a play account; positive, not proven; real
   but too small to trade; not there.
6. **Limits added.** The pair candidate is the best of 2,352 tries (336
   versions on seven markets), so luck alone makes it look good in the
   choosing years more easily than the candidate. The spreads of the four new
   pairs are assumed typical values.

## Amendment 3: points made exact for the two programmers (2026-11-18 morning, before any code was written)

The plan was read once more while the build was being set up. Each point
below could be read two ways, or was left unsaid. Nothing has been computed.

1. **The first candle of a file** has no previous close: its true range is
   its high minus its low. So the first ATR exists at the 14th candle and no
   swing is confirmed before it. Until then the candidate still moves.
2. **A pattern's year** (Part 1) is the year of its confirming candle's close
   (UTC). A trade's year is still the year of its fill minute.
3. **The cross-check of the two pattern finders** covers both swing sizes and
   every pattern whose confirming candle closes in 2015: its four points, D,
   the stop, and what the wait did (skipped by the confirming-candle rule,
   completed and in which minute, or cancelled and why). Prices must agree to
   1e-9, times and outcomes exactly.
4. **The 0.2 pip is a cost, not part of a price.** A market entry is at the
   minute's open (the Bid for a sell, the Bid plus the spread for a buy). R,
   the targets at 1 to 3 R and the twins' distances are measured from that
   price. A stop fills at the stop level, or at the minute's open when the
   open is already beyond it. Each market fill then lowers the result by 0.2
   pip.
5. **The time exit** closes the trade at the open of the first 1-minute
   candle of the 481st chart candle, before any other test in that minute.
6. **X3.** In the minute the first half is taken, nothing else happens to the
   rest. From the next minute on the rest has its stop at the entry price and
   X2's target, the stop first. A stop at the entry price is a stop fill.
   Each half carries half of every cost.
7. **Look-back measures** (Parts 2 and 3). "How far price went" is a move of
   the Bid, measured from the Bid at the entry, before costs. The minute that
   hits the stop counts as the full distance to the stop and adds nothing in
   favour. "Worth after N hours" is the result of closing at market at the
   open of the first minute at or after that time; a trade already closed by
   its stop or by the time exit keeps that result. Targets in R and in pips
   are measured from the entry price and tested like any target, with the
   stop and the time exit.
8. **Pooling in Parts 2 and 3.** Each table pools both charts, both swing
   sizes and all four patterns, per market and for all markets together. The
   same tables split by chart, swing size and pattern go into the result
   files.
9. **"Above zero"** for a year, a half or a market means the sum of its
   results in R is above zero; one with no trade is not above zero. A tie in
   the ranking goes to the version that comes first in this order: pattern
   set (Butterfly alone, then all four), chart, swing size, entry, exit.
10. **Thirds by size of R** use R divided by the entry price, so that markets
    can be compared.
11. **The end of the data.** In the checking run a trade still open at the
    last minute of the file is closed there at market, as the choosing run
    does at the last minute of 2018. A pattern still waiting then gives no
    trade.
12. **Twins.** The moved minute must exist in the file with exactly that
    stamp. The twin enters at that minute's open. The random moves come from
    one fixed generator, named in the results, with seeds 1 to 200.
13. **The checking run computes all 336 versions on 2019 to 2025** in its
    single run, because the count of versions above zero and the rank
    correlation (Spearman, over versions with a trade in both periods) need
    them. Nothing from it is used to choose.
14. **Indicators.** RSI does not exist before 14 changes; until then its test
    is false. With no losses in its average, RSI is 100. The 4-hour candles
    are built from the 1-minute file on New York time with daylight saving,
    and their EMA(50) is seeded with the first 4-hour close.
15. **Keeping the checking years out of reach while the code is written.**
    The programmers work on copies of the files that end at 2018-12-31. The
    full files are made unreadable until the check.

## Results

### Written before the choosing tables were read (2026-11-18)

**How the code was checked.** The engine and a second pattern finder were
written by two programmers who did not see each other's code (TypeScript and
Python). Their pattern lists match exactly on GBP/USD 15-minute candles for
2015, for both swing sizes (196 and 117 patterns), and on three wider cases
(gold 30-minute 2012, USD/JPY 15-minute 2016, EUR/GBP 30-minute 2011). Two
reviewers then read the code against this page, one for anything that could
see the future, one for trades, costs and statistics; a third re-worked 309
and then 1,754 trades from the 1-minute candles with a program of his own.
They found no look-ahead and no wrong number. Their thirteen findings were
about guards, missing tests and the two readings below; all are fixed, each
with a test. All of this used copies of the files that end at 2018-12-31,
while the full files were unreadable.

**Readings taken where this page left a point open.** None was chosen by
looking at a result.

1. _The end of the data_ (Amendment 1 point 6, Amendment 3 point 11): a trade
   that is open at the last minute closes at that minute's open, before any
   other test, as the time exit does. A trade that only opened inside the
   last minute closes at that minute's close, after its stop test.
2. _The pair candidate_ (Amendment 2 point 2) is checked whether or not a
   version qualifies on all markets together.
3. _C2_, the reversal candle, has no RSI condition: its trigger replaces
   C1's.
4. _Gold_: between the completing minute and the trigger, the cancel tests of
   C1 and C2 use the spread taken at D. A twin's spread comes from its own
   entry Bid.
5. _Twins_: one draw per market and UTC fill date, from the generator
   mulberry32 with seeds 1 to 200; a twin whose trades are all left out does
   not count as beaten; a twin may land in the last days of 2018.
6. _New York time_ follows each year's daylight-saving law (before 2007 the
   older rule).
7. _Thirds by size of R_ are cut at one third and two thirds of the trades,
   rounded down, the largest third taking the rest.
8. _Part 1_ counts every year in the files; "formed" includes patterns
   skipped by the confirming-candle rule.
9. _The splits_ by chart, swing size and pattern are one at a time, not
   crossed.
10. _A tie between pair candidates_ goes to the version order of Amendment 3
    point 9, then the markets in the order EUR/USD, GBP/USD, gold, USD/JPY,
    EUR/GBP, EUR/JPY, GBP/JPY.

### The answer (run 2026-11-18)

**"Not there."** The patterns form often, but trading the point where they
are supposed to end is a coin flip that leans the wrong way, on every one of
the seven markets, with or without a confirmation.

- **How often it worked, 2010 to 2018.** 4,372 trades with an order at D.
  Price went a median of 12 pips the trade's way and 13 pips against it. A
  target as far as the stop (1 R) came first 43.7% of the time; it needs more
  than 50% to pay. No target from 5 to 50 pips, or from 0.5 to 3 R, made
  money, before costs or after. Holding for 4 to 120 hours did not either
  (one hold, 72 hours, was a little above zero before costs and below it
  after).
- **Per pair.** All seven lost at 1 R. The best was EUR/GBP at about zero
  before costs. No pair stands out, and the best pair of the old years
  (GBP/JPY, below) lost in the new ones.
- **With a confirmation.** RSI and EMA, the method as John remembered it,
  triggers rarely: 167 trades in nine years on seven markets, 16 to 34 a
  market. It lost a little at 1 R. At a far target (3 R) it showed +0.18 R a
  trade in 2010 to 2018 and +0.03 R in 2019 to 2025 on 132 trades: too few to
  tell from luck. Adding the bigger trend made it look better still in the old
  years (+0.33 R, 89 trades) and then it lost in the new ones (-0.23 R, 74
  trades). The reversal candle, the trend alone and the London and New York
  hours all lost after costs in both periods.
- **The one rule that qualified** (all four patterns, 30-minute chart, swing
  size 3, order at D with the bigger trend, target at 0.618) earned +0.025 R a
  trade in 2010 to 2018 with a weekly t of 0.29. On 2019 to 2025 it lost
  0.172 R a trade over 275 trades and was ahead of 6 of its 200 twins.
- **The best pair** in the old years, GBP/JPY (all four patterns, 15-minute
  chart, swing size 2, order at D, target at 0.618), lost 0.091 R a trade
  over 152 trades in the new years and was ahead of 47 of its 200 twins.
- **Costs, one line.** The stops are small here (about 15 pips), so the
  spread takes about 0.10 R a trade; but the trades lose before costs too.

### What was run

- Code: commit `9a9aace` on `lab/harmonic-patterns`, pushed before either
  run. The choosing run read copies of the files that end at 2018-12-31. The
  check ran once, at 2026-11-18 14:31 UTC, and wrote its marker first.
- Before the check the seven full files were loaded once with the study's own
  loader, to make sure it accepts them. Row counts only; nothing was computed.
- All seven markets passed the clock check and were used. The files (SHA-256):

```
fdd9fe3c4695653951eef8b47a0099bfa8e8c07887d68a09512c4c9ac336afb2  EURUSD/EURUSD_1m.fixed.csv.gz
2a5559d1bdcbecb2ae807778561206a0831fc404d5d8153ef8686e769723f538  GBPUSD/GBPUSD_1m.fixed.csv.gz
2ee908c82589366e558a52b5f904c6a9c2e4c2bf7ab578ac0fad50a15eb65d01  XAUUSD/XAUUSD_1m.fixed.csv.gz
f0101ef0ec20ab373c3fabcfe84cc3144c8f85914e74b8da4a987cabffc4183b  USDJPY/USDJPY_1m.fixed.csv.gz
5fe9c0b3b02df71c2f8df3426f07afbaf1b59028465fb0b23462bd01ab15e64a  EURGBP/EURGBP_1m.fixed.csv.gz
cf0abfe2de0d150e6c2022c3805b6b0495d85fc28aa42f044f1f7e17f298bf1a  EURJPY/EURJPY_1m.fixed.csv.gz
b787ac5199f94dd58088173be0437ea39b0f7d6d16df975fe0363f9f270d6547  GBPJPY/GBPJPY_1m.fixed.csv.gz
```

- The full tables of both runs are in `docs/harmonic-results/` (`choose.md`,
  `check.md`).

### Part 1: how often the patterns appear

Seven markets, both charts, both swing sizes. About one pattern in five gets
to its end point; the rest are cancelled first.

| Pattern   | Formed 2010 to 2018 | Price reached D | Cancelled first | Passed D inside the confirming candle | Formed 2019 to 2025 | Price reached D |
| --------- | ------------------- | --------------- | --------------- | ------------------------------------- | ------------------- | --------------- |
| Gartley   | 7399                | 2324 (31.4%)    | 4503            | 572                                   | 5351                | 1684 (31.5%)    |
| Bat       | 5598                | 868 (15.5%)     | 4677            | 53                                    | 3941                | 529 (13.4%)     |
| Butterfly | 10237               | 2083 (20.3%)    | 7926            | 228                                   | 7577                | 1440 (19.0%)    |
| Crab      | 4493                | 262 (5.8%)      | 4226            | 4                                     | 3245                | 169 (5.2%)      |
| All four  | 27727               | 5537 (20.0%)    | 21332           | 857                                   | 20114               | 3822 (19.0%)    |

### Part 2: the look-back, order at D, 2010 to 2018

Both charts, both swing sizes and all four patterns together. "Went my way"
and "went against" are how far the Bid moved from the entry, before costs
(gold's figures are in pips of $0.10). 1,165 more patterns were skipped
because their stop was nearer than five times the cost.

| Market    | Trades | Went my way (median) | Went against (median) | Reached +10 pips first | Reached 1 R first | Average at 1 R, before costs | After costs |
| --------- | ------ | -------------------- | --------------------- | ---------------------- | ----------------- | ---------------------------- | ----------- |
| All seven | 4372   | 12.2 pips            | 13.4 pips             | 49.9%                  | 43.7%             | -0.047 R                     | -0.150 R    |
| EUR/USD   | 707    | 9.9 pips             | 11.6 pips             | 47.0%                  | 43.4%             | -0.057 R                     | -0.144 R    |
| GBP/USD   | 664    | 10.2 pips            | 12.5 pips             | 48.9%                  | 41.6%             | -0.091 R                     | -0.181 R    |
| Gold      | 559    | 23.1 pips            | 21.9 pips             | 50.4%                  | 44.0%             | -0.068 R                     | -0.189 R    |
| USD/JPY   | 698    | 9.2 pips             | 9.3 pips              | 45.8%                  | 44.8%             | -0.033 R                     | -0.139 R    |
| EUR/GBP   | 448    | 8.7 pips             | 7.4 pips              | 45.1%                  | 44.4%             | -0.001 R                     | -0.126 R    |
| EUR/JPY   | 668    | 14.6 pips            | 14.5 pips             | 53.4%                  | 44.5%             | -0.029 R                     | -0.125 R    |
| GBP/JPY   | 628    | 17.5 pips            | 18.0 pips             | 57.8%                  | 43.2%             | -0.037 R                     | -0.145 R    |

Every target, all seven markets (pip targets are in pips; gold's in dollars):

| Target             | Reached before the stop | Average before costs | Average after costs |
| ------------------ | ----------------------- | -------------------- | ------------------- |
| 0.5 R              | 56.4%                   | -0.072 R             | -0.174 R            |
| 1 R                | 43.7%                   | -0.047 R             | -0.150 R            |
| 1.5 R              | 35.5%                   | -0.034 R             | -0.139 R            |
| 2 R                | 29.1%                   | -0.048 R             | -0.154 R            |
| 3 R                | 21.5%                   | -0.065 R             | -0.171 R            |
| 5 pips (gold $1)   | 61.8%                   | -1.2 pips            | -2.6 pips           |
| 10 pips (gold $2)  | 49.9%                   | -1.0 pips            | -2.5 pips           |
| 15 pips (gold $3)  | 42.5%                   | -0.7 pips            | -2.2 pips           |
| 20 pips (gold $5)  | 36.3%                   | -0.8 pips            | -2.3 pips           |
| 30 pips (gold $8)  | 29.0%                   | -0.6 pips            | -2.1 pips           |
| 50 pips (gold $12) | 21.0%                   | -0.2 pips            | -1.7 pips           |

In the plan's fixed words: **no target made money; the best row is the
least-losing one, not a sweet spot.** That holds for the targets in R and for
the targets in pips.

What the trade was worth after a hold, stop in place:

| Held for  | Above zero then, before costs | Average before costs | Average after costs |
| --------- | ----------------------------- | -------------------- | ------------------- |
| 4 hours   | 31.7%                         | -0.061 R             | -0.171 R            |
| 12 hours  | 22.6%                         | -0.041 R             | -0.151 R            |
| 24 hours  | 17.5%                         | -0.042 R             | -0.152 R            |
| 48 hours  | 14.1%                         | -0.016 R             | -0.125 R            |
| 72 hours  | 12.4%                         | +0.052 R             | -0.058 R            |
| 120 hours | 9.1%                          | -0.005 R             | -0.115 R            |

The same trade split three ways:

| Split (entry at D, all markets) | Trades | Reached 1 R first | Average at 1 R, before costs | After costs |
| ------------------------------- | ------ | ----------------- | ---------------------------- | ----------- |
| Gartley                         | 2196   | 45.6%             | -0.011 R                     | -0.103 R    |
| Bat                             | 828    | 41.7%             | -0.112 R                     | -0.197 R    |
| Butterfly                       | 1093   | 39.8%             | -0.093 R                     | -0.238 R    |
| Crab                            | 255    | 49.8%             | +0.055 R                     | -0.023 R    |
| 15-minute chart                 | 2574   | 43.0%             | -0.054 R                     | -0.164 R    |
| 30-minute chart                 | 1798   | 44.7%             | -0.037 R                     | -0.130 R    |
| Swing size 2                    | 2535   | 43.0%             | -0.052 R                     | -0.163 R    |
| Swing size 3                    | 1837   | 44.5%             | -0.040 R                     | -0.132 R    |

### Part 3: do the confirmations help?

All four patterns, both charts and both swing sizes together. The first
columns are the choosing years; the columns for 2019 to 2025 come from the
check and are description only.

| Entry (all four patterns, both charts, both swing sizes) | Trades 2010 to 2018 | Average at 1 R, after costs | Average at 3 R, after costs | Trades 2019 to 2025 | Won at 1 R, before costs | Average at 1 R, before costs | After costs | Average at 3 R, before costs | After costs |
| -------------------------------------------------------- | ------------------- | --------------------------- | --------------------------- | ------------------- | ------------------------ | ---------------------------- | ----------- | ---------------------------- | ----------- |
| E0, order at D                                           | 4372                | -0.150 R                    | -0.171 R                    | 2887                | 42.6%                    | -0.067 R                     | -0.172 R    | -0.058 R                     | -0.166 R    |
| C1, RSI and EMA                                          | 167                 | -0.053 R                    | +0.176 R                    | 132                 | 43.2%                    | -0.097 R                     | -0.150 R    | +0.084 R                     | +0.030 R    |
| C2, reversal candle                                      | 1625                | -0.080 R                    | -0.035 R                    | 1163                | 45.0%                    | -0.047 R                     | -0.119 R    | +0.002 R                     | -0.072 R    |
| C3, with the bigger trend                                | 2310                | -0.129 R                    | -0.143 R                    | 1578                | 41.6%                    | -0.098 R                     | -0.199 R    | -0.070 R                     | -0.175 R    |
| C4, London and New York hours                            | 2381                | -0.176 R                    | -0.235 R                    | 1558                | 40.3%                    | -0.113 R                     | -0.215 R    | -0.115 R                     | -0.221 R    |
| C5, trend plus RSI and EMA                               | 89                  | -0.112 R                    | +0.333 R                    | 74                  | 39.2%                    | -0.179 R                     | -0.227 R    | -0.180 R                     | -0.230 R    |

C1 trades per market, 2010 to 2018: EUR/USD 32, GBP/USD 16, Gold 17, USD/JPY 34, EUR/GBP 22, EUR/JPY 21, GBP/JPY 25.

### Part 4: choosing and the single check

**Choosing, 2010 to 2018.** 1 of the 336 versions qualified: all four
patterns, 30-minute chart, swing size 3, entry C3, exit X2. 400 trades, 28.0%
won before costs, +0.103 R a trade before costs and +0.025 R after, sums of
+9.16 R and +0.90 R in the two halves, weekly t 0.29. Of the 2,352 versions
on one market alone, 4 qualified; the best by weekly t was GBP/JPY, all four
patterns, 15-minute chart, swing size 2, entry E0, exit X2: 250 trades, 32.0%
won before costs, +0.142 R before costs and +0.021 R after, weekly t 0.22.

**The check, 2019 to 2025.**

| Line (after costs)                        | The candidate, all markets | The pair candidate, GBP/JPY |
| ----------------------------------------- | -------------------------- | --------------------------- |
| 1. Trades (200; pair 100)                 | 275, holds                 | 152, holds                  |
| 2. Weekly t of 2.5 or more                | -1.75, no                  | -0.77, no                   |
| 3. At least 5 of 7 years above zero       | 2, no                      | 2, no                       |
| 4. Ahead of at least 190 of 200 twins     | 6, no                      | 47, no                      |
| 5. Above zero at double cost              | -0.256 R a trade, no       | -0.212 R a trade, no        |
| 6. More than half the markets above zero  | 2 of 7, no                 | not used                    |
| Won before costs                          | 24.7%                      | 30.3%                       |
| Average a trade before costs, after costs | -0.088 R, -0.172 R         | +0.030 R, -0.091 R          |
| **Reading**                               | **"Not there"**            | **"Not there"**             |

Before costs neither clears lines 2 and 4, so neither is "real but too small
to trade", and neither is above zero after costs, so neither is "positive,
not proven".

**Did choosing carry information?** Of the 336 versions, 36 were above zero
after costs on 2019 to 2025: none with an order at D alone or with the
London and New York hours, and only one with at least 200 trades (at +0.001
R a trade). The rank correlation of a version's average result between the
two periods is 0.16.

### What it means

The Butterfly family behaves like the Fibonacci pullback this lab tested
before, which is no surprise: its end points are the same Fibonacci levels.
The five-point shape, the confirmations and the choice of target do not turn
a coin flip into an edge on these seven markets. The next test asks the
question one step earlier: does price turn at a level at all, more often than
at a nearby price (`docs/levels-study.md`, branch `lab/indicator-research`).
