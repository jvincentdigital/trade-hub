# The Golden Owl turned upside down: plan

Lab study, play money only. **Plan written 2026-11-17 before any number of
this study was computed** (one rough estimate from saved runs is described
below). Results go at the bottom; the plan above them is not edited.

## Why

`docs/owl-copy-study.md` showed that our copy of the Owl loses as sold and in
1,080 versions of its own settings. John asked: what if everything went the
other way, and can we change the parameters to make a better robot out of
that?

## What is already known

- Flipping only the entry signal's short-average part was half of the 1,080
  versions (540). None made money after costs.
- The as-sold copy loses a little even with no costs at all (2019 to 2022:
  about -$2,500 with no costs, -$9,117 at the typical cost).
- A rough estimate from the two saved choosing runs (result with costs minus
  twice the result without) says the exact opposite of the as-sold version
  would also have lost (about -$4,100), and that some versions in London and
  whole-day hours might show gains. That estimate breaks on accounts that
  went bust, so it decides nothing; it is why this study exists.

## The flipped robot

A **shadow** copy of the Owl runs on paper, with the rules of
`docs/owl-copy-study.md`, on a paper balance that is $50,000 at the start of
every session (so its pause and stop lines never move). The **real** account
does the exact opposite: when the shadow opens a trade, the real account
opens the opposite trade of the same size at the same moment; when the shadow
closes trades (target, stop, hidden rule, end of session), the real account
closes the opposite ones.

The shadow buys at the Ask and sells at the Bid, and so does the real
account, so both pay the spread and the commission. Per session:

```
real result = -(shadow result) - (2 * (spread + 0.07) + slip) * ounces traded
```

The real account starts at $50,000, carries its balance, and stops trading
under a tenth of its start. Its worst point inside a session is taken as the
opposite of the shadow's best point, less the session's costs.

In plain words the flipped robot sells into a short burst upward, adds to the
position when the move keeps going its way, takes a small loss when the price
snaps back the usual dollar, and collects when the Owl's pile would have
failed. Many small losses, a few large gains.

## Costs

- typical: spread $0.28, commission $0.07, slip 0
- price-scaled: spread $0.28 times the session's first price over $1,800
- **slow hands**: typical plus $0.20 per ounce. The flipped robot earns by
  trading at the edge of 1-minute candles, where the price often snaps back
  within seconds. A real order arrives late and exits through a stop order.
  This level stands in for that.

## Choosing

All 1,080 versions of the copy study, flipped, on 2019-01-01 to 2022-12-31 at
the typical cost. A version is in when it ends above $50,000 with a worst
drop of 20% or less. Ranked by gain divided by worst drop (a drop under 0.5%
counts as 0.5%). The first 10 are the candidates. If there are none, the
study ends: **"the flip does not survive"**.

## Checking, on years no Owl test has touched

- **Main check: gold 2012-01-01 to 2018-12-31**, free 1-minute files from
  HistData, downloaded only after this plan is pushed and after the choosing
  run. The clock of those files is converted as in the v1 exam (New York
  winter time plus the European summer hour) and verified on the weekly
  reopen before use. Run once.
- Side check: 2023 to 2024 from the files we have. Not blind (we already know
  every Owl version lost there), so it can only count against a candidate.
- 2025 to 2026 are reported and not used: the candles are too coarse, and we
  already know the Owl versions were wiped out there, which flatters any
  flipped version.

A candidate **passes** when, over 2012 to 2018, it gains at least 5% with a
worst drop of 20% or less at the typical, the price-scaled and the slow-hands
cost, makes money in at least 5 of the 7 years at the typical cost, and does
not lose in 2023 to 2024 at the typical cost.

**Reading fixed now:**

- **"A flipped robot worth a play account"**: at least 7 of the 10 candidates
  pass (with fewer than 10 candidates: at least 70% of them, and at least 3).
  Then the first candidate is proposed to John as one play-money account,
  with the warning below.
- **"The flip does not survive"**: no candidates, or fewer than half of them
  pass.
- **"Unclear"**: anything in between. No account is proposed.

## Limits, said in advance

- **Fills.** Even a pass is a result on 1-minute candles. Whether a real
  order can sell at the top of a one-minute burst, before it snaps back, can
  only be measured with tick data. A pass earns a play account and a tick
  test, nothing more.
- The flipped versions are chosen from the same 1,080 settings that were
  designed for the Owl. This is not a search for the best possible robot.
- Our copy follows public code, not the compiled Owl.
- Play money only. No broker is connected. This is not financial advice.

## Results (2026-11-17)

**The flip does not survive.** None of the 1,080 flipped versions ended the
choosing years (2019 to 2022) above its start at the typical cost. There are
no candidates, so by the plan the study ends here. The untouched years (2012
to 2018) were not downloaded and not looked at.

| Hours and the shadow's signal        | Versions | Made money | Median end | Best end |
| ------------------------------------ | -------- | ---------- | ---------- | -------- |
| Owl evenings, signal as sold         | 180      | 0          | $44,328    | $48,344  |
| Owl evenings, short average inverted | 180      | 0          | $44,711    | $48,470  |
| London hours, signal as sold         | 180      | 0          | $21,723    | $45,066  |
| London hours, short average inverted | 180      | 0          | $25,609    | $44,609  |
| Whole trading day, signal as sold    | 180      | 0          | $6,287     | $43,100  |
| Whole trading day, inverted          | 180      | 0          | $13,309    | $44,701  |

### Why flipping changes nothing

The as-sold version on 2019 to 2022 at the typical cost, on the 27,219 ounces
it traded:

|                            | Before costs | Spread and commission | After costs |
| -------------------------- | ------------ | --------------------- | ----------- |
| The Owl (the shadow)       | +$409        | -$9,527               | -$9,117     |
| The Owl turned upside down | -$409        | -$9,527               | -$9,936     |

Before costs the two sides are almost even over four years. Each side then
pays about 35 cents an ounce to trade, and that is the whole loss. The
flipped version lost in each of the four years (-$833, -$4,746, -$2,312,
-$2,045).

With no costs at all the flip is the exact negative of the copy, and 869 of
the 1,080 flipped versions would have ended above their start. So the
instinct behind the question points the right way: the Owl is a little more
often on the wrong side than the right one. The size is what fails. That lean
is worth a few cents an ounce, and a trade costs 35.

### What this means

1. **It was never about the direction.** The Owl does not lose because it
   buys where it should sell. It loses because it trades very often for an
   edge that is close to zero, and both sides of such a trade pay the costs.
2. **No setting can fix that.** Step, size growth, stop, hours and direction
   only change how often it trades and how the loss arrives. Counting both
   studies, 2,160 robots built from these rules were tested and none made
   money after costs.
3. **A better robot needs a different idea, not a different setting:** an
   entry whose average gain per trade is clearly bigger than what the trade
   costs, which also means trading far less often for bigger moves.

### Checks and deviations

- The flip arithmetic has a unit test on hand-made prices, and the two losses
  above add up to twice the costs, as they must.
- After the first run one printed line was added (the shadow's own result and
  its costs). The result file is identical before and after.
- The main check and the side check were not run: there was nothing to check.
