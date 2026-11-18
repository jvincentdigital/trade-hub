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

## Results

Not run yet.
