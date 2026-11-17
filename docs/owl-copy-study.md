# Our own copy of the Golden Owl, as sold and tweaked: plan

Lab study, play money only. **Plan written 2026-11-17 before any number of
this study was computed.** Two reviewers read a draft and their findings are
folded in (a stricter pass bar, a price-scaled cost level, a third verdict,
exact rounding and blocking rules). Results are added at the bottom after the
run and the plan above them is not edited.

## Why

John asked (2026-11-17) whether we can decode his old robot, copy it, tweak
it and make it better. The decode is in `docs/owl-decoded.md`: the Golden Owl
EA V9 is a renamed build of xBest, a free robot with public code. This study
rebuilds its trading rules as our own code (written from the rule
descriptions, no code copied), runs it on gold history, and then tests
whether changing its own settings makes it pay.

It replaces Part 2 of `docs/owl-study.md`, which was an illustration built
before the rules were known (both sides always in the market). The bounce
count in Part 1 of that study stands.

## Data

- Gold 1-minute candles, the same series as `docs/owl-study.md`: HistData
  2019-01-01 to 2025-12-31 (sha256 `918b9c81...bcbcf3`), then the frozen
  Dukascopy file 2026-01-01 to 2026-11-10. Candle prices are treated as the
  Bid.
- **Sessions.** "Owl evenings": Monday, Tuesday and Wednesday, candles
  stamped 18:05 through 23:59 New York time (the seller's hours). "London
  hours": 07:00 through 16:29 London time, Monday to Friday. A session sits
  out when fewer than 90% of its minutes have a candle. A missing minute
  inside a kept session adds nothing; trades stay open across it.
- **Known limit, said in advance.** Decisions in the real robot happen on
  every price change; we only have 1-minute candles. In 2025 and 2026 gold
  moves several dollars a minute, so those two years are the least reliable.
  Every verdict below is therefore read twice: on the years the candles
  resolve well, and on all years.

## The copy: rules as we implement them

Source of every rule: `docs/owl-decoded.md` and the full record it points to.

**Averages.** Over the whole candle series (so they are warm when a session
starts), with `ema[0] = value[0]` and `ema[i] = k * value[i] + (1 - k) *
ema[i-1]`: `emaHigh` and `emaLow` on highs and lows with `k = 0.5` (3
candles), `emaOpen` on opens with `k = 2/35` (34 candles).

**Moments.** Every candle's open is a moment of its own, reached by a jump
from the previous close (the gap is not walked). Then the price walks open to
low to high to close when the candle closed up or flat, and open to high to
low to close when it closed down. A leg from `a` to `b` of zero length adds
no moment; otherwise `n = ceil(abs(b - a) / 0.10 - 1e-9)` and the moments are
`a + (b - a) * k / n` for `k = 1..n`.

**Signal** at a moment inside candle `i`, with price `p` (the Bid), and `H`
and `L` the highest and lowest moment of candle `i` so far (at the open, both
are the open):

```
hi = 0.5 * H + 0.5 * emaHigh[i-1]
lo = 0.5 * L + 0.5 * emaLow[i-1]
ma = emaOpen[i]
short = +1 if p > hi, -1 if p < lo, else 0
long  = +1 if p > ma, -1 if p < ma, else 0
signal = short if short equals long, else 0
```

With the robot's "Invert Filter" (used only in Part C), `short` changes sign
before the comparison.

**Prices and costs.** Ask = Bid + spread, constant inside a session. Buys
open at the Ask and close at the Bid; sells open at the Bid and close at the
Ask. A commission of $0.07 per ounce is charged when a trade closes. Three
cost levels:

- best: spread $0.13 (total $0.20 a round trip, as in the first study)
- typical: spread $0.28 (total $0.35)
- price-scaled: spread $0.28 times the session's first price divided by
  $1,800 (dollar spreads grow with the price; this is the fair level for
  2024 to 2026)

**Rounding.** Lots round half up to 0.01: `floor(x * 100 + 0.5 + 1e-9) /
100`. Prices round the same way to one cent where the rules say so.

**State.** Each side (buys, sells) has its open trades, a target, a stored
count and a pause flag. At the start of every session both stored counts are
0 and both flags are clear (the robot is attached fresh each evening). Only
step 4a writes a stored count; no close changes one.

**At every moment, in this order:**

1. **Targets.** Buys close when the Bid is at or above the buy target, sells
   when the Ask is at or below the sell target. All of that side's trades
   close at the target price; at a candle-open moment (a jump) they close at
   that moment's Bid (buys) or Ask (sells) instead.
   Then note, for step 4c, each side's most recent trade size if it still
   has open trades (0 if it has none).
2. **Stop.** Open result = sum over open trades of ounces times (Bid - entry)
   for buys and (entry - Ask) for sells, without commission. Equity = balance
   at the session start + results closed so far in the session + open result.
   If the open result is negative and its size is strictly greater than
   `stopPct / 100` times equity: close everything at market (buys at the
   Bid, sells at the Ask) and the session is over.
3. **Hidden rule.** If the open result is at least $1.00 and either side's
   stored count is above 12: close everything at market; trading goes on.
4. **Engine.** If the signal is +1 the buy engine acts; if -1 the sell
   engine; if 0 neither. With `fA` and `fB` the buy and sell pause flags as
   left by earlier calls:
   - a. `n` = the side's open trades now; its stored count becomes `n`.
   - b. If `n > 0`: the side adds a trade of `lots(n)` at market when the
     price is a full grid step worse than its most recent trade (buys:
     `lastEntry - Ask >= grid - 1e-9`; sells: `Bid - lastEntry >= grid -
1e-9`), `n` is under the trade limit, and it is not blocked. A buy add
     is blocked when `fA` is set; a sell add when `fA` or `fB` is set.
   - c. If `n == 0`: the side opens its first trade at market unless it is
     blocked. A first buy is blocked when `fA` is set and `fB` is not; a
     first sell when exactly one of `fA`, `fB` is set. Its size is
     `lots(0)`, unless the other side's stored count is above 2 and the size
     noted for the other side in step 1 is not 0: then it is that size
     divided by the factor, rounded to 0.01 lot, at least 0.01 and at most
     the largest size (main reading; see "Sensitivity").
   - d. The side's pause flag is then set when its own open result, before
     the trade opened in this call, is negative and its size is strictly
     greater than `pausePct / 100` times equity (as in step 2, at this
     moment); otherwise it is cleared. This happens on every call, whether
     or not a trade opened.
   - e. After a trade opens, the side's target = the weighted average entry
     rounded to one cent, plus the take distance for buys (minus for sells).
     In that average, trades already open count at 2 cents worse than their
     entry (entry minus 0.02 for buys, plus 0.02 for sells) and the new
     trade at its own entry.
5. **End of session.** After the last moment's steps, everything still open
   is closed at market at that moment's prices.

`lots(n)` = first size times factor to the power `n`, rounded, at most the
largest size. One lot is 100 ounces. At most one trade opens per side per
moment.

**As sold (passive 50k file):** $50,000 account, first trade 0.02 lots, grid
$1.00, take $1.00, factor 1.357, largest trade 0.5 lots, pause 2%, stop 4%,
no trade limit. The balance carries from session to session; the first trade
size does not change with it. An account under a tenth of its start stops
trading.

Not copied, and why: the aggressive files (their trailing stop of 20 cents
and break-even of 3 cents cannot be simulated with 1-minute candles) and the
universal files (their first trade size depends on the broker's margin).

## Order of work (so later years cannot leak into the code)

1. Unit tests, the cross-check with a second implementation, and any bug fix
   use 2019 to 2022 only.
2. The code is committed and pushed. Its commit is named in the results.
3. Only then is any number from 2023 or later computed. A fix after that
   point is reported as a deviation, with the first result kept beside the
   rerun.

## Part A: the Owl as sold

The passive 50k rules on every Owl evening from 2019 to November 2026. Per
year: evenings, sequences closed at their target, evenings that hit the stop,
the year's result in dollars and percent. Overall: the end balance and the
worst drop.

Worst drop = the largest fall from the highest earlier end-of-session balance
to the lowest point reached later (open trades included), in percent of that
high.

Runs: the main reading at the best, typical and price-scaled cost, and three
sensitivity runs at the typical cost, declared now:

- **First trade refused.** The public code does not round the resized first
  trade of step 4c, which a broker may refuse. In this run that trade is not
  opened at all.
- **Start over after a stop.** Ending the evening after a stop follows the
  later fork's "remove the robot" switch (medium-low confidence). xBest itself
  starts over at once. In this run trading goes on after a stop.
- **Reversed order inside a candle.** Up candles walk open, high, low, close
  and down candles open, low, high, close.

## Part B: does the signal pay for itself?

No money rules, only prices. A fresh signal is a candle inside an Owl evening
whose close gives a buy or sell signal (the formula above with `p` = close
and `H`, `L` = the candle's high and low) when the previous candle's close
did not give the same one. Its move is the change in price to the close 5, 15
and 60 minutes later (the last candle at or before that time; not measured
when that time is at or past the end of the session), in the signal's
direction.

Per year, for buys, sells and both together: the average over evenings of
the evening's average move, with two standard errors across evenings; next to
it the base rate (the same measure from every candle of the same evenings,
with no signal) and the move after taking the evening's base rate out.

**Reading fixed now:** the signal "pays its cost over 15 minutes" if the
average 15-minute move in its direction (buys and sells together) is above
that year's price-scaled typical cost ($0.35 times the year's average first
price divided by $1,800) in at least 6 of the 8 years. Otherwise it "does not
pay its cost over 15 minutes". Also stated: in how many years the move with
the base rate taken out differs from zero by more than two standard errors.

## Part C: can a tweak make it pay?

Every combination of the robot's own knobs below, 720 versions, each on a
$50,000 account with first trade 0.02 lots and largest trade 0.5 lots:

| Knob                             | Values                                                         |
| -------------------------------- | -------------------------------------------------------------- |
| Grid step                        | $1.00; $2.00; 0.05%, 0.10%, 0.20% of the session's first price |
| Take distance                    | the grid step; half the grid step                              |
| Factor for added trades          | 1.0 (no growth); 1.357; 2.0                                    |
| Short-average part of the signal | as sold; inverted                                              |
| Stop and pause                   | 4% and 2%; 2% and 1%                                           |
| Most trades per side             | no limit; 8; 4                                                 |
| Hours                            | Owl evenings; London hours                                     |

**Choosing** uses only 2019-01-01 to 2022-12-31 at the typical cost. A
version is in when it ended those years above $50,000 with a worst drop of
20% or less. They are ranked by gain divided by worst drop (gain as a share
of $50,000; a worst drop under 0.5% counts as 0.5%). The first 10 are the
candidates.

**Checking** uses 2023-01-01 to 2026-11-10, which the choosing never saw.
Each candidate starts again at $50,000. The check is run once; the runner
writes a marker and refuses to repeat it.

A candidate **passes a period** when all of these hold over that period:

- at the typical cost and at the price-scaled cost it gains at least 5% with
  a worst drop of 20% or less;
- at the typical cost it ends ahead of at least 19 of its 20 "twins". A twin
  is the same version with its signal moved in time inside each session by a
  random amount between a quarter and three quarters of the session (seeds 1
  to 20). A twin's signal is on as often and for as long as the real one,
  but no longer has anything to do with the price at that moment;
- with the order inside a candle reversed, at the typical cost, it still
  gains at least 5% with a worst drop of 20% or less.

The two periods are 2023 to 2024 (candles resolve well) and 2023 to November
2026 (all checking years).

**Reading fixed now:**

- **"A tweak worth a play account"**: at least 7 of the 10 candidates pass
  both periods, and the ones that do use at least 2 different grid steps.
  Then the first candidate is proposed to John as one play-money account.
- **"No tweak survives"**: fewer than 7 pass 2023 to 2024 and fewer than 7
  pass 2023 to 2026. Recommendation: do not build an Owl-style account.
- **"Unclear: needs finer price data"**: anything else. No account is
  proposed.

Also reported: how many of the 720 made money in the choosing years; how
many of all 720 gained at least 5% with a worst drop of 20% or less in the
checking years; the rank correlation between a version's results in the two
periods; and where the as-sold version stands among the 720.

## How the numbers are checked

- Unit tests for the copy's rules on hand-made prices.
- A helper who has not seen our code writes its own Part A (main reading,
  typical cost) from this page, in another language, on the same files, for
  2019 to 2022. The two must agree on every evening's result to the cent;
  any difference is found and explained before anything else runs.

## Limits

- This is our reading of public code, not the compiled Owl (see "What we
  could not confirm" in `docs/owl-decoded.md`).
- 1-minute candles and an assumed path inside each candle. The spread is
  constant inside a session; real spreads are widest in the first hour after
  the reopen, which this study does not charge for.
- Open trades' commission is not counted in equity until they close (a few
  dollars on the stop and pause lines).
- The list of knobs was written after the earlier study had seen all years
  (the percent grid steps exist because of what gold did in 2025 and 2026),
  so the check is not fully blind.
- The seller's manual rules (avoid news, stop at a daily goal) are not
  simulated; a daily goal is not in the preset files.
- Play money only. No broker is connected. This is not financial advice.

## Amendment 1 (2026-11-17, before any number from 2023 or later)

Written after the cross-check on 2019 to 2022 and before the code was frozen.
What had been seen at that point, and nothing else: the as-sold copy on 2019
to 2022. It lost at every cost level ($50,000 became $41,729 at the best
cost, $40,883 at the typical cost, $39,058 at the price-scaled cost), and the
breakdown at the typical cost was: closes at a target +$15,860, closes at the
end of the evening -$24,977, no stop at all. The two implementations agreed
on all 621 evenings to the cent.

So the money is lost when unfinished piles are closed at midnight, which is
the seller's own rule. The 720 versions of Part C all share that handicap
(London hours are only 9.5 hours long). One value is therefore added to the
"Hours" knob of Part C:

- **Whole trading day:** candles stamped 18:05 New York through 16:54 New
  York the next afternoon, starting Sunday to Thursday evenings (five a week;
  22 hours 50 minutes; sits out under 90% of its minutes). What is still open
  is closed at market at the end of each trading day, before the daily break.

Part C now has 1,080 versions. Everything else in the plan is unchanged: the
choosing years, the ranking, the 10 candidates, the checks and the three
readings. The preset files themselves leave the robot's clock off, so this is
how the robot runs when nobody switches it off.

## Results

Not run yet.
